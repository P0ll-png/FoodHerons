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

        // Authorization depends on who is allowed to make this move.
        var authorized = plan.Value!.Kind switch
        {
            TransitionKind.StudentCancel => state.StudentId == userId.Value || await IsVendorOwnerAsync(db, state.VendorId, userId.Value, ct),
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
            applied = await db.ApplyTransitionAsync(orderService, id, to, request.Reason?.Trim(), ct);
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
    // Helpers
    // ===================================================================

    private static async Task<bool> IsVendorOwnerAsync(Db db, string vendorId, Guid userId, CancellationToken ct)
    {
        var vendor = await db.GetVendorAsync(vendorId, ct);
        return vendor?.OwnerId == userId;
    }

    private static OrderDto ToOrderDto(OrderRow r) => new(
        r.Id, r.Code, r.Status, r.VendorId, r.Subtotal, r.Total,
        r.PlacedAt, r.AcceptedAt, r.ReadyAt, r.CompletedAt, r.CancelledAt, r.CancelReason);

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
