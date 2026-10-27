namespace FoodHerons.Api.Services;

/// <summary>Machine-readable error codes returned on 4xx responses (design §4).</summary>
public static class ErrorCodes
{
    public const string ItemUnavailable = "ITEM_UNAVAILABLE";
    public const string VendorClosed = "VENDOR_CLOSED";
    public const string IllegalTransition = "ILLEGAL_TRANSITION";
    public const string Validation = "VALIDATION";
}

/// <summary>Canonical order_status values (mirrors the Postgres enum, design §4).</summary>
public static class OrderStatuses
{
    public const string Pending = "pending";
    public const string Preparing = "preparing";
    public const string Ready = "ready";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        Pending, Preparing, Ready, Completed, Cancelled
    };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}

/// <summary>
/// A menu item's trusted server-side data for one (vendorId, menuItemId).
/// Supplied to <see cref="OrderService"/> as an input so the pure total logic is
/// testable with no live DB.
/// </summary>
public sealed record MenuItemInfo(string MenuItemId, string Name, decimal Price, bool Available);

/// <summary>A domain failure carrying a machine-readable code + HTTP status + optional detail.</summary>
public sealed class DomainError(int status, string code, string message, IReadOnlyDictionary<string, object?>? extensions = null)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public string Message { get; } = message;
    public IReadOnlyDictionary<string, object?>? Extensions { get; } = extensions;
}

/// <summary>Result of pure total computation: priced lines + subtotal/total.</summary>
public sealed record ComputedOrder(IReadOnlyList<PricedLine> Lines, decimal Subtotal, decimal Total);

/// <summary>A merged, priced line produced by <see cref="OrderService"/>.</summary>
public sealed record PricedLine(string MenuItemId, string Name, decimal UnitPrice, int Qty);

/// <summary>Classification of a requested transition for authorization routing.</summary>
public enum TransitionKind
{
    /// <summary>A vendor-driven move: preparing / ready / completed, or a vendor reject-to-cancelled.</summary>
    VendorAction,

    /// <summary>A student cancelling their own order (legal only while pending).</summary>
    StudentCancel
}

/// <summary>Outcome of validating a transition against the state machine.</summary>
public sealed record TransitionPlan(string From, string To, TransitionKind Kind);
