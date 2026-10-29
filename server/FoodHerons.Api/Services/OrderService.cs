using FoodHerons.Api.Dtos;

namespace FoodHerons.Api.Services;

/// <summary>
/// Pure, DB-free order logic: input validation, server-side total computation,
/// Asia/Manila openness evaluation, and the status transition state machine.
///
/// All external facts (menu prices, current order status) arrive as inputs so
/// this class is fully unit-testable with no live Postgres. Npgsql specifics
/// live in <c>Data/Db.cs</c>.
/// </summary>
public sealed class OrderService
{
    /// <summary>Asia/Manila is a FIXED UTC+8 offset with no DST — do not depend on a Windows tz id.</summary>
    public static readonly TimeSpan ManilaOffset = TimeSpan.FromHours(8);

    // ---- Validation bounds (design §4) -----------------------------------
    public const int PickupNameMin = 2;
    public const int PickupNameMax = 80;
    public const int NoteMax = 280;
    public const int ItemsMin = 1;
    public const int ItemsMax = 50;
    public const int QtyMin = 1;
    public const int QtyMax = 99;
    public const int ReasonMax = 140;
    public const int GcashRefMin = 4;
    public const int GcashRefMax = 40;

    // ===================================================================
    // Place-order input validation
    // ===================================================================

    /// <summary>
    /// Validates a <see cref="PlaceOrderRequest"/>'s shape (not existence/openness).
    /// Returns null on success, or a 422 <see cref="DomainError"/> with a field detail.
    /// </summary>
    public DomainError? ValidatePlaceOrder(PlaceOrderRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.VendorId))
            return Invalid("vendorId", "vendorId is required.");

        var pickup = request.PickupName?.Trim() ?? string.Empty;
        if (pickup.Length < PickupNameMin || pickup.Length > PickupNameMax)
            return Invalid("pickupName", $"pickupName must be {PickupNameMin}-{PickupNameMax} characters after trimming.");

        if (request.Note is not null && request.Note.Trim().Length > NoteMax)
            return Invalid("note", $"note must be at most {NoteMax} characters.");

        var items = request.Items;
        if (items is null || items.Length < ItemsMin)
            return Invalid("items", "At least one item is required.");
        if (items.Length > ItemsMax)
            return Invalid("items", $"At most {ItemsMax} items are allowed.");

        foreach (var line in items)
        {
            if (string.IsNullOrWhiteSpace(line.MenuItemId))
                return Invalid("items", "Each item requires a menuItemId.");
            if (line.Qty < QtyMin || line.Qty > QtyMax)
                return Invalid("items", $"qty must be between {QtyMin} and {QtyMax}.");
        }

        return null;
    }

    /// <summary>
    /// The distinct, merged (menuItemId -> total qty) map for a validated request.
    /// Duplicate line ids are summed. Call <see cref="ValidatePlaceOrder"/> first.
    /// </summary>
    public static IReadOnlyDictionary<string, int> MergeLines(PlaceOrderRequest request)
    {
        var merged = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var line in request.Items ?? [])
        {
            var id = line.MenuItemId!;
            merged[id] = merged.TryGetValue(id, out var existing) ? existing + line.Qty : line.Qty;
        }
        return merged;
    }

    // ===================================================================
    // Total computation (server prices win; client has no price field)
    // ===================================================================

    /// <summary>
    /// Computes the priced order from merged quantities and a trusted menu lookup.
    /// <paramref name="menu"/> maps menuItemId -> <see cref="MenuItemInfo"/> for the
    /// target vendor. An unknown or unavailable item yields an ITEM_UNAVAILABLE error.
    /// subtotal == total == sum(unitPrice * qty).
    /// </summary>
    public Result<ComputedOrder> ComputeOrder(
        IReadOnlyDictionary<string, int> mergedLines,
        IReadOnlyDictionary<string, MenuItemInfo> menu)
    {
        var lines = new List<PricedLine>(mergedLines.Count);
        decimal subtotal = 0m;

        foreach (var (menuItemId, qty) in mergedLines)
        {
            if (!menu.TryGetValue(menuItemId, out var info) || !info.Available)
                return Result<ComputedOrder>.Fail(ItemUnavailable(menuItemId));

            var lineTotal = info.Price * qty;
            subtotal += lineTotal;
            lines.Add(new PricedLine(menuItemId, info.Name, info.Price, qty));
        }

        return Result<ComputedOrder>.Ok(new ComputedOrder(lines, subtotal, subtotal));
    }

    // ===================================================================
    // Asia/Manila openness (fixed UTC+8, overnight-wrap aware)
    // ===================================================================

    /// <summary>
    /// Evaluates whether a vendor is open "now" in Asia/Manila (fixed UTC+8).
    /// Hours are stored as PH wall-clock "HH:mm" strings. Handles the overnight-wrap
    /// case (close &lt; open) and treats '00:00'/'00:00' as always closed.
    /// </summary>
    public bool IsOpenNow(string hoursOpen, string hoursClose, DateTimeOffset utcNow)
    {
        // '00:00'/'00:00' is the schema default meaning "no hours set" => closed.
        if (hoursOpen == "00:00" && hoursClose == "00:00")
            return false;

        if (!TryParseHm(hoursOpen, out var open) || !TryParseHm(hoursClose, out var close))
            return false;

        var manilaNow = utcNow.ToOffset(ManilaOffset);
        var now = new TimeSpan(manilaNow.Hour, manilaNow.Minute, 0);

        return open <= close
            ? now >= open && now < close            // normal same-day window
            : now >= open || now < close;            // overnight-wrap window
    }

    private static bool TryParseHm(string value, out TimeSpan result)
    {
        result = default;
        if (string.IsNullOrWhiteSpace(value)) return false;
        var parts = value.Split(':');
        if (parts.Length != 2) return false;
        if (!int.TryParse(parts[0], out var h) || !int.TryParse(parts[1], out var m)) return false;
        if (h < 0 || h > 23 || m < 0 || m > 59) return false;
        result = new TimeSpan(h, m, 0);
        return true;
    }

    // ===================================================================
    // Transition state machine
    // ===================================================================

    // Legal transitions, EXACTLY (design §4).
    public static readonly HashSet<(string From, string To)> Legal = new()
    {
        (OrderStatuses.Pending, OrderStatuses.Preparing),
        (OrderStatuses.Preparing, OrderStatuses.Ready),
        (OrderStatuses.Ready, OrderStatuses.Completed),
        (OrderStatuses.Pending, OrderStatuses.Cancelled),
        (OrderStatuses.Preparing, OrderStatuses.Cancelled),
        // GCash-gated pre-order states (design §4.2).
        (OrderStatuses.PaymentSubmitted, OrderStatuses.Pending),
        (OrderStatuses.PaymentSubmitted, OrderStatuses.AwaitingPayment),
        (OrderStatuses.AwaitingPayment, OrderStatuses.Cancelled),
        (OrderStatuses.PaymentSubmitted, OrderStatuses.Cancelled),
    };

    /// <summary>
    /// Validates a status transition and classifies it for authorization routing.
    /// A student cancel (pending/awaiting_payment/payment_submitted -&gt; cancelled)
    /// is student/vendor/admin-driven; a payment review (payment_submitted -&gt;
    /// pending / awaiting_payment) is vendor-owner-or-admin; everything else is a
    /// vendor action. Returns an ILLEGAL_TRANSITION error for any
    /// skip/backward/terminal move.
    /// </summary>
    public Result<TransitionPlan> PlanTransition(string from, string to)
    {
        if (!OrderStatuses.IsValid(to))
            return Result<TransitionPlan>.Fail(Invalid("to", "to must be a valid order status.")!);

        if (!Legal.Contains((from, to)))
            return Result<TransitionPlan>.Fail(IllegalTransition(from, to));

        TransitionKind kind;
        if (from == OrderStatuses.PaymentSubmitted &&
            (to == OrderStatuses.Pending || to == OrderStatuses.AwaitingPayment))
        {
            // Verify (-> pending) / reject (-> awaiting_payment): vendor owner or admin.
            kind = TransitionKind.PaymentReview;
        }
        else if (to == OrderStatuses.Cancelled &&
                 (from == OrderStatuses.Pending ||
                  from == OrderStatuses.AwaitingPayment ||
                  from == OrderStatuses.PaymentSubmitted))
        {
            // Student owner / vendor owner / (pre-payment only) admin cancel.
            kind = TransitionKind.StudentCancel;
        }
        else
        {
            kind = TransitionKind.VendorAction;
        }

        return Result<TransitionPlan>.Ok(new TransitionPlan(from, to, kind));
    }

    /// <summary>
    /// Validates a transition request body (reason rules). Returns null on success.
    /// Three buckets (design §4.4): a reason is REQUIRED when cancelling or
    /// rejecting payment (to == cancelled or awaiting_payment), FORBIDDEN
    /// otherwise (including the verify move to == pending and all forward moves),
    /// and must be at most <see cref="ReasonMax"/> chars.
    /// </summary>
    public DomainError? ValidateTransition(TransitionRequest request)
    {
        if (!OrderStatuses.IsValid(request.To))
            return Invalid("to", "to must be a valid order status.");

        var reasonRequired =
            request.To is OrderStatuses.Cancelled or OrderStatuses.AwaitingPayment;
        var reason = request.Reason?.Trim();

        if (reasonRequired && string.IsNullOrWhiteSpace(reason))
            return Invalid("reason", "reason is required when cancelling or rejecting payment.");
        if (!reasonRequired && !string.IsNullOrEmpty(request.Reason))
            return Invalid("reason", "reason is only allowed when cancelling or rejecting payment.");
        if (reason is not null && reason.Length > ReasonMax)
            return Invalid("reason", $"reason must be at most {ReasonMax} characters.");

        return null;
    }

    /// <summary>
    /// Validates a <see cref="SubmitPaymentRequest"/>'s reference-string rules
    /// (design §4.4/§4.6). The GCash reference is required, trimmed to
    /// <see cref="GcashRefMin"/>-<see cref="GcashRefMax"/> chars, and may contain
    /// only digits, spaces and hyphens. The screenshotPath shape/route-id check
    /// is NOT performed here (it needs the route id) — it lives at the endpoint.
    /// Returns null on success or a 422 <see cref="DomainError"/> with field
    /// "gcashReference".
    /// </summary>
    public DomainError? ValidateSubmitPayment(SubmitPaymentRequest request)
    {
        var reference = request.GcashReference?.Trim();

        if (string.IsNullOrWhiteSpace(reference))
            return Invalid("gcashReference", "gcashReference is required.");
        if (reference.Length < GcashRefMin || reference.Length > GcashRefMax)
            return Invalid("gcashReference", $"gcashReference must be {GcashRefMin}-{GcashRefMax} characters after trimming.");
        if (!reference.All(c => char.IsDigit(c) || c == ' ' || c == '-'))
            return Invalid("gcashReference", "gcashReference may contain only digits, spaces and hyphens.");

        return null;
    }

    // ===================================================================
    // Error helpers
    // ===================================================================

    private static DomainError Invalid(string field, string message) =>
        new(422, ErrorCodes.Validation, message,
            new Dictionary<string, object?> { ["field"] = field });

    private static DomainError ItemUnavailable(string menuItemId) =>
        new(422, ErrorCodes.ItemUnavailable, "A requested item is unknown or unavailable.",
            new Dictionary<string, object?> { ["menuItemId"] = menuItemId });

    private static DomainError IllegalTransition(string from, string to) =>
        new(409, ErrorCodes.IllegalTransition, "That status change is not allowed.",
            new Dictionary<string, object?> { ["from"] = from, ["to"] = to });
}

/// <summary>A tiny success/failure result carrying either a value or a <see cref="DomainError"/>.</summary>
public sealed class Result<T>
{
    private Result(bool success, T? value, DomainError? error)
    {
        IsSuccess = success;
        Value = value;
        Error = error;
    }

    public bool IsSuccess { get; }
    public T? Value { get; }
    public DomainError? Error { get; }

    public static Result<T> Ok(T value) => new(true, value, null);
    public static Result<T> Fail(DomainError error) => new(false, default, error);
}
