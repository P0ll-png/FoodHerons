using FoodHerons.Api.Auth;
using FoodHerons.Api.Data;
using FoodHerons.Api.Dtos;
using FoodHerons.Api.Services;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace FoodHerons.Api.Endpoints;

/// <summary>
/// Minimal API endpoints for the write-only order service:
/// <c>POST /api/orders</c> and <c>POST /api/orders/{id}/transition</c>.
/// Reads are served direct-to-Supabase under RLS, so there is NO GET endpoint.
/// </summary>
public static class OrdersEndpoints
{
    public static RouteGroupBuilder MapOrderEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/orders", PlaceOrderAsync);
        group.MapPost("/orders/{id:guid}/transition", TransitionAsync);
        group.MapPost("/orders/{id:guid}/payment", SubmitPaymentAsync);
        return group;
    }

    // ===================================================================
    // POST /api/orders
    // ===================================================================
    private static async Task<IResult> PlaceOrderAsync(
        PlaceOrderRequest request,
        HttpContext http,
        OrderService orderService,
        Db db,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var log = loggerFactory.CreateLogger("Orders.Place");

        var userId = http.User.GetUserId();
        if (userId is null)
            return Problem(http, StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Authentication required.");

        if (!string.Equals(http.User.GetRole(), "student", StringComparison.Ordinal))
        {
            log.LogWarning("Place-order rejected: caller {UserId} is not a student.", userId);
            return Problem(http, StatusCodes.Status403Forbidden, "FORBIDDEN", "Only students can place orders.");
        }

        var validationError = orderService.ValidatePlaceOrder(request);
        if (validationError is not null)
            return FromDomainError(http, validationError);

        var vendorId = request.VendorId!;

        VendorInfo? vendor;
        IReadOnlyDictionary<string, MenuItemInfo> menu;
        var merged = OrderService.MergeLines(request);
        try
        {
            vendor = await db.GetVendorAsync(vendorId, ct);
            if (vendor is null || !vendor.PreorderEnabled || !orderService.IsOpenNow(vendor.HoursOpen, vendor.HoursClose, DateTimeOffset.UtcNow))
            {
                log.LogInformation("Place-order rejected: vendor {VendorId} unavailable/closed.", vendorId);
                return Problem(http, StatusCodes.Status409Conflict, ErrorCodes.VendorClosed, "This vendor is not accepting orders right now.");
            }

            menu = await db.GetMenuItemsAsync(vendorId, merged.Keys, ct);
        }
        catch (Exception ex)
        {
            var correlationId = http.TraceIdentifier;
            log.LogError(ex, "Place-order DB read failure. correlationId={CorrelationId} user={UserId} vendor={VendorId}",
                correlationId, userId, vendorId);
            return ServerError(http, correlationId);
        }

        var computed = orderService.ComputeOrder(merged, menu);
        if (!computed.IsSuccess)
            return FromDomainError(http, computed.Error!);

        var items = computed.Value!.Lines
            .Select(l => new OrderItemInput(l.MenuItemId, vendorId, l.Name, l.UnitPrice, l.Qty))
            .ToList();

        OrderRow row;
        try
        {
            row = await db.InsertOrderAsync(
                userId.Value, vendorId, computed.Value.Subtotal, computed.Value.Total,
                request.PickupName!.Trim(), string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
                items, ct);
        }
        catch (Exception ex)
        {
            var correlationId = http.TraceIdentifier;
            log.LogError(ex, "Place-order DB failure. correlationId={CorrelationId} user={UserId} vendor={VendorId}",
                correlationId, userId, vendorId);
            return ServerError(http, correlationId);
        }

        log.LogInformation("Order placed {Code} for user {UserId}.", row.Code, userId);

        var response = new PlaceOrderResponse(
            row.Id, row.Code, row.Status, row.Subtotal, row.Total, row.VendorId,
            computed.Value.Lines.Select(l => new ResponseLine(l.MenuItemId, l.Name, l.UnitPrice, l.Qty)).ToArray(),
            row.PlacedAt);

        return Results.Created($"/api/orders/{row.Id}", response);
    }

    // ===================================================================
    // POST /api/orders/{id}/transition
    // ===================================================================
    private static async Task<IResult> TransitionAsync(
        Guid id,
        TransitionRequest request,
        HttpContext http,
        OrderService orderService,
        Db db,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var log = loggerFactory.CreateLogger("Orders.Transition");

        var userId = http.User.GetUserId();
        if (userId is null)
            return Problem(http, StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Authentication required.");

        var bodyError = orderService.ValidateTransition(request);
        if (bodyError is not null)
            return FromDomainError(http, bodyError);

        var state = await db.GetOrderStateAsync(id, ct);
        if (state is null)
            return Problem(http, StatusCodes.Status404NotFound, "NOT_FOUND", "Order not found.");

        var to = request.To!;

        var plan = orderService.PlanTransition(state.Status, to);
        if (!plan.IsSuccess)
            return FromDomainError(http, plan.Error!);

        var isAdmin = string.Equals(http.User.GetRole(), "admin", StringComparison.Ordinal);

        // Authorization depends on who is allowed to make this move.
        var authorized = plan.Value!.Kind switch
        {
            // Student owner or vendor owner always; admin ONLY for the two
            // pre-payment from-states (design §4.4) — never a plain pending cancel.
            TransitionKind.StudentCancel =>
                state.StudentId == userId.Value
                || await IsVendorOwnerAsync(db, state.VendorId, userId.Value, ct)
                || (isAdmin && plan.Value.From is OrderStatuses.AwaitingPayment or OrderStatuses.PaymentSubmitted),
            // Verify/reject payment: vendor owner or admin.
            TransitionKind.PaymentReview =>
                isAdmin || await IsVendorOwnerAsync(db, state.VendorId, userId.Value, ct),
            TransitionKind.VendorAction => await IsVendorOwnerAsync(db, state.VendorId, userId.Value, ct),
            _ => false
        };

        if (!authorized)
        {
            log.LogWarning("Transition rejected: caller {UserId} not authorized for order {OrderId}.", userId, id);
            return Problem(http, StatusCodes.Status403Forbidden, "FORBIDDEN", "You are not allowed to change this order.");
        }

        Result<OrderRow> applied;
        try
        {
            applied = await db.ApplyTransitionAsync(orderService, id, to, request.Reason?.Trim(), userId.Value, ct);
        }
        catch (Exception ex)
        {
            var correlationId = http.TraceIdentifier;
            log.LogError(ex, "Transition DB failure. correlationId={CorrelationId} order={OrderId}", correlationId, id);
            return ServerError(http, correlationId);
        }

        if (!applied.IsSuccess)
            return FromDomainError(http, applied.Error!);

        var row = applied.Value!;
        log.LogInformation("Order {Code} transitioned to {Status} by {UserId}.", row.Code, row.Status, userId);

        return Results.Ok(ToOrderDto(row));
    }

    // ===================================================================
    // POST /api/orders/{id}/payment
    // ===================================================================
    private static async Task<IResult> SubmitPaymentAsync(
        Guid id,
        SubmitPaymentRequest request,
        HttpContext http,
        OrderService orderService,
        Db db,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var log = loggerFactory.CreateLogger("Orders.Payment");

        var userId = http.User.GetUserId();
        if (userId is null)
            return Problem(http, StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Authentication required.");

        if (!string.Equals(http.User.GetRole(), "student", StringComparison.Ordinal))
        {
            log.LogWarning("Submit-payment rejected: caller {UserId} is not a student.", userId);
            return Problem(http, StatusCodes.Status403Forbidden, "FORBIDDEN", "Only students can submit payment.");
        }

        // Reference-string rules (pure service).
        var bodyError = orderService.ValidateSubmitPayment(request);
        if (bodyError is not null)
            return FromDomainError(http, bodyError);

        // Authoritative screenshot-path check (design §4.4): when provided, the
        // path's first '/'-segment must equal this route's order id with a
        // non-empty remainder, so a student can't attach a proof under another
        // order's prefix.
        var screenshotPath = request.ScreenshotPath;
        if (screenshotPath is not null)
        {
            var slash = screenshotPath.IndexOf('/');
            var firstSegment = slash >= 0 ? screenshotPath[..slash] : screenshotPath;
            var rest = slash >= 0 ? screenshotPath[(slash + 1)..] : string.Empty;
            if (!string.Equals(firstSegment, id.ToString(), StringComparison.OrdinalIgnoreCase) || rest.Length == 0)
                return FromDomainError(http, new DomainError(422, ErrorCodes.Validation,
                    "screenshotPath must start with this order's id.",
                    new Dictionary<string, object?> { ["field"] = "screenshotPath" }));
        }

        var state = await db.GetOrderStateAsync(id, ct);
        if (state is null)
            return Problem(http, StatusCodes.Status404NotFound, "NOT_FOUND", "Order not found.");

        if (state.StudentId != userId.Value)
        {
            log.LogWarning("Submit-payment rejected: caller {UserId} is not the owner of order {OrderId}.", userId, id);
            return Problem(http, StatusCodes.Status403Forbidden, "FORBIDDEN", "You are not allowed to pay for this order.");
        }

        Result<OrderRow> applied;
        try
        {
            applied = await db.SubmitPaymentAsync(id, request.GcashReference!.Trim(), screenshotPath, ct);
        }
        catch (Exception ex)
        {
            var correlationId = http.TraceIdentifier;
            log.LogError(ex, "Submit-payment DB failure. correlationId={CorrelationId} order={OrderId}", correlationId, id);
            return ServerError(http, correlationId);
        }

        if (!applied.IsSuccess)
            return FromDomainError(http, applied.Error!);

        var row = applied.Value!;
        log.LogInformation("Payment submitted for order {Code} by {UserId}.", row.Code, userId);

        return Results.Ok(ToOrderDto(row));
    }

    // ===================================================================
    // Helpers
    // ===================================================================

    private static async Task<bool> IsVendorOwnerAsync(Db db, string vendorId, Guid userId, CancellationToken ct)
    {
        var vendor = await db.GetVendorAsync(vendorId, ct);
        return vendor?.OwnerId == userId;
    }

    private static OrderDto ToOrderDto(OrderRow r) => new(
        r.Id, r.Code, r.Status, r.VendorId, r.Subtotal, r.Total,
        r.PlacedAt, r.AcceptedAt, r.ReadyAt, r.CompletedAt, r.CancelledAt, r.CancelReason,
        r.GcashReference, r.PaymentSubmittedAt, r.PaymentVerifiedAt, r.PaymentRejectedReason, r.PaymentScreenshotPath);

    private static IResult FromDomainError(HttpContext http, DomainError error)
    {
        var problem = new ProblemDetails
        {
            Status = error.Status,
            Title = error.Message,
        };
        problem.Extensions["code"] = error.Code;
        if (error.Extensions is not null)
        {
            foreach (var (key, value) in error.Extensions)
                problem.Extensions[key] = value;
        }
        return Results.Problem(problem);
    }

    private static IResult Problem(HttpContext http, int status, string code, string message)
    {
        var problem = new ProblemDetails { Status = status, Title = message };
        problem.Extensions["code"] = code;
        return Results.Problem(problem);
    }

    private static IResult ServerError(HttpContext http, string correlationId)
    {
        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status500InternalServerError,
            Title = "An unexpected error occurred.",
        };
        problem.Extensions["code"] = "INTERNAL";
        problem.Extensions["correlationId"] = correlationId;
        return Results.Problem(problem);
    }
}
