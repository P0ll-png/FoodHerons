namespace FoodHerons.Api.Dtos;

/// <summary>
/// Request body for POST /api/orders. The client sends ONLY item ids and
/// quantities — there is structurally no price field anywhere, so a client
/// cannot influence the order total. Prices are resolved server-side from the DB.
/// </summary>
public sealed record PlaceOrderRequest(
    string? VendorId,
    string? PickupName,
    string? Note,
    LineItemDto[]? Items);

/// <summary>A single requested line: a menu item id and a quantity. No price.</summary>
public sealed record LineItemDto(
    string? MenuItemId,
    int Qty);

/// <summary>201 response for a placed order.</summary>
public sealed record PlaceOrderResponse(
    Guid Id,
    string Code,
    string Status,
    decimal Subtotal,
    decimal Total,
    string VendorId,
    ResponseLine[] Items,
    DateTimeOffset PlacedAt);

/// <summary>A priced, named line as persisted (price/name snapshot from the DB).</summary>
public sealed record ResponseLine(
    string MenuItemId,
    string Name,
    decimal UnitPrice,
    int Qty);

/// <summary>Request body for POST /api/orders/{id}/transition.</summary>
public sealed record TransitionRequest(
    string? To,
    string? Reason);

/// <summary>200 response for a transition (and the general order view shape).</summary>
public sealed record OrderDto(
    Guid Id,
    string Code,
    string Status,
    string VendorId,
    decimal Subtotal,
    decimal Total,
    DateTimeOffset PlacedAt,
    DateTimeOffset? AcceptedAt,
    DateTimeOffset? ReadyAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset? CancelledAt,
    string? CancelReason);
