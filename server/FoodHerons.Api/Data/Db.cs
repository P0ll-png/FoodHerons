using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using FoodHerons.Api.Services;

namespace FoodHerons.Api.Data;

/// <summary>A vendor row needed for placement authorization + openness.</summary>
public sealed record VendorInfo(
    string Id,
    Guid? OwnerId,
    bool PreorderEnabled,
    string HoursOpen,
    string HoursClose);

/// <summary>The current state of an order loaded for a transition (under row lock).</summary>
public sealed record OrderState(
    Guid Id,
    string Status,
    Guid StudentId,
    string VendorId);

/// <summary>A persisted order row (projection for responses).</summary>
public sealed record OrderRow(
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

/// <summary>Input for a single persisted order line.</summary>
public sealed record OrderItemInput(string MenuItemId, string VendorId, string Name, decimal UnitPrice, int Qty);

/// <summary>
/// The Supabase-backed data layer. Talks to the Supabase project over HTTPS (443)
/// via a typed <see cref="HttpClient"/> whose <c>BaseAddress</c> is
/// <c>${Supabase:Url}/rest/v1/</c> and whose <c>apikey</c>/<c>Authorization: Bearer</c>
/// headers carry the service-role key (so RLS is bypassed, matching the old
/// service-role connection). Reads (<see cref="GetVendorAsync"/>,
/// <see cref="GetMenuItemsAsync"/>, <see cref="GetOrderStateAsync"/>) are PostgREST
/// GETs; the two transactional writes are Postgres RPCs invoked over
/// <c>POST /rest/v1/rpc/...</c>: <c>place_order</c> (atomic orders + order_items insert)
/// and <c>transition_order</c> (locked read + guarded status/timestamp update).
///
/// Pure order logic lives in <see cref="OrderService"/>; this class only moves rows.
/// It never forwards Supabase response bodies to callers: a non-2xx on a read or an
/// insert throws a sanitized exception the endpoint turns into a clean 500, and a
/// transition maps the RPC's <c>FH001</c>/<c>FH002</c> code to a <see cref="DomainError"/>.
/// </summary>
public sealed class Db(HttpClient http)
{
    private readonly HttpClient _http = http;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Loads a vendor's placement-relevant fields, or null if it does not exist.</summary>
    public async Task<VendorInfo?> GetVendorAsync(string vendorId, CancellationToken ct)
    {
        var url = $"vendors?id=eq.{Uri.EscapeDataString(vendorId)}" +
                  "&select=id,owner_id,preorder_enabled,hours_open,hours_close&limit=1";

        var rows = await GetArrayAsync<VendorDto>(url, ct);
        if (rows.Count == 0) return null;

        var v = rows[0];
        return new VendorInfo(v.Id, v.OwnerId, v.PreorderEnabled, v.HoursOpen, v.HoursClose);
    }

    /// <summary>
    /// Looks up name/price/available for the given menu item ids within one vendor.
    /// Missing ids are simply absent from the returned map (caller treats as unavailable).
    /// </summary>
    public async Task<IReadOnlyDictionary<string, MenuItemInfo>> GetMenuItemsAsync(
        string vendorId, IEnumerable<string> menuItemIds, CancellationToken ct)
    {
        var ids = menuItemIds.Distinct(StringComparer.Ordinal).ToArray();
        var result = new Dictionary<string, MenuItemInfo>(StringComparer.Ordinal);
        if (ids.Length == 0) return result;

        // PostgREST in.(...) treats commas as separators; wrap each id in double
        // quotes and backslash-escape embedded " and \ so reserved characters are
        // safe, then URL-escape the whole quoted token.
        var inList = string.Join(",", ids.Select(QuoteInValue));

        var url = $"menu_items?vendor_id=eq.{Uri.EscapeDataString(vendorId)}" +
                  $"&id=in.({inList})&select=id,name,price,available";

        var rows = await GetArrayAsync<MenuItemDto>(url, ct);
        foreach (var row in rows)
            result[row.Id] = new MenuItemInfo(row.Id, row.Name, row.Price, row.Available);

        return result;
    }

    /// <summary>
    /// Inserts an order + its items in a single transaction via the <c>place_order</c>
    /// RPC. The DB assigns the human-friendly <c>code</c> (sequence default),
    /// <c>placed_at</c>, and the default <c>pending</c> status; the RPC returns the new
    /// orders row as a single JSON object deserialized directly into <see cref="OrderRow"/>.
    /// </summary>
    public async Task<OrderRow> InsertOrderAsync(
        Guid studentId,
        string vendorId,
        decimal subtotal,
        decimal total,
        string pickupName,
        string? note,
        IReadOnlyList<OrderItemInput> items,
        CancellationToken ct)
    {
        var body = new PlaceOrderRpcBody(
            studentId,
            vendorId,
            subtotal,
            total,
            pickupName,
            note,
            items.Select(i => new PlaceOrderRpcItem(i.MenuItemId, i.VendorId, i.Name, i.UnitPrice, i.Qty)).ToArray());

        using var response = await _http.PostAsJsonAsync("rpc/place_order", body, JsonOptions, ct);
        if (!response.IsSuccessStatusCode)
            throw Fatal("place_order", response.StatusCode);

        var row = await ReadObjectAsync<OrderRowDto>(response, "place_order", ct);
        return ToOrderRow(row);
    }

    /// <summary>
    /// Loads an order's current state for pre-transition authorization/not-found checks.
    /// This is a non-locking PostgREST read; the authoritative lost-race check happens
    /// under <c>FOR UPDATE</c> inside the <c>transition_order</c> RPC.
    /// </summary>
    public async Task<OrderState?> GetOrderStateAsync(Guid orderId, CancellationToken ct)
    {
        var url = $"orders?id=eq.{Uri.EscapeDataString(orderId.ToString())}" +
                  "&select=id,status,student_id,vendor_id&limit=1";

        var rows = await GetArrayAsync<OrderStateDto>(url, ct);
        if (rows.Count == 0) return null;

        var s = rows[0];
        return new OrderState(s.Id, s.Status, s.StudentId, s.VendorId);
    }

    /// <summary>
    /// Applies a validated transition atomically via the <c>transition_order</c> RPC,
    /// which locks the row, re-evaluates the legal-pair whitelist under the lock, and
    /// updates status + the matching lifecycle timestamp (+ cancel_reason on cancel).
    /// On 2xx the returned single JSON object is the updated row. On any non-2xx the
    /// response body's <c>code</c> field is read regardless of HTTP status (status only
    /// 2xx-vs-not): <c>FH001</c> -&gt; ILLEGAL_TRANSITION, <c>FH002</c> -&gt; NOT_FOUND;
    /// anything else is fatal and throws. The <paramref name="orderService"/> parameter
    /// is retained for the endpoint call site but no longer used for planning (the
    /// under-lock guard lives in SQL).
    /// </summary>
    public async Task<Result<OrderRow>> ApplyTransitionAsync(
        OrderService orderService,
        Guid orderId,
        string to,
        string? reason,
        CancellationToken ct)
    {
        var body = new TransitionRpcBody(orderId, to, reason);

        using var response = await _http.PostAsJsonAsync("rpc/transition_order", body, JsonOptions, ct);

        if (response.IsSuccessStatusCode)
        {
            var row = await ReadObjectAsync<OrderRowDto>(response, "transition_order", ct);
            return Result<OrderRow>.Ok(ToOrderRow(row));
        }

        // Non-2xx: map off the body `code` field, NOT the HTTP status.
        var code = await TryReadErrorCodeAsync(response, ct);
        return code switch
        {
            "FH001" => Result<OrderRow>.Fail(new DomainError(409, ErrorCodes.IllegalTransition, "That status change is not allowed.")),
            "FH002" => Result<OrderRow>.Fail(new DomainError(404, "NOT_FOUND", "Order not found.")),
            _ => throw Fatal("transition_order", response.StatusCode),
        };
    }

    // ===================================================================
    // HTTP helpers — never surface Supabase response bodies to callers.
    // ===================================================================

    private async Task<IReadOnlyList<T>> GetArrayAsync<T>(string relativeUrl, CancellationToken ct)
    {
        using var response = await _http.GetAsync(relativeUrl, ct);
        if (!response.IsSuccessStatusCode)
            throw Fatal(relativeUrl, response.StatusCode);

        try
        {
            var rows = await response.Content.ReadFromJsonAsync<List<T>>(JsonOptions, ct);
            return rows ?? [];
        }
        catch (JsonException)
        {
            throw new InvalidOperationException($"Supabase returned a malformed response for '{relativeUrl}'.");
        }
    }

    private static async Task<T> ReadObjectAsync<T>(HttpResponseMessage response, string op, CancellationToken ct)
    {
        try
        {
            var obj = await response.Content.ReadFromJsonAsync<T>(JsonOptions, ct);
            if (obj is null)
                throw new InvalidOperationException($"Supabase returned an empty body for '{op}'.");
            return obj;
        }
        catch (JsonException)
        {
            throw new InvalidOperationException($"Supabase returned a malformed response for '{op}'.");
        }
    }

    private static async Task<string?> TryReadErrorCodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var error = await response.Content.ReadFromJsonAsync<PostgrestError>(JsonOptions, ct);
            return error?.Code;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>A sanitized fatal error — carries no Supabase response body.</summary>
    private static InvalidOperationException Fatal(string op, System.Net.HttpStatusCode status) =>
        new($"Supabase request '{op}' failed with status {(int)status}.");

    private static OrderRow ToOrderRow(OrderRowDto r) => new(
        r.Id, r.Code, r.Status, r.VendorId, r.Subtotal, r.Total,
        r.PlacedAt, r.AcceptedAt, r.ReadyAt, r.CompletedAt, r.CancelledAt, r.CancelReason);

    private static string QuoteInValue(string id)
    {
        var escaped = id.Replace("\\", "\\\\").Replace("\"", "\\\"");
        return Uri.EscapeDataString($"\"{escaped}\"");
    }

    // ===================================================================
    // Private PostgREST payload DTOs (snake_case via Web defaults).
    // ===================================================================

    private sealed record VendorDto(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("owner_id")] Guid? OwnerId,
        [property: JsonPropertyName("preorder_enabled")] bool PreorderEnabled,
        [property: JsonPropertyName("hours_open")] string HoursOpen,
        [property: JsonPropertyName("hours_close")] string HoursClose);

    private sealed record MenuItemDto(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("price")] decimal Price,
        [property: JsonPropertyName("available")] bool Available);

    private sealed record OrderStateDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("student_id")] Guid StudentId,
        [property: JsonPropertyName("vendor_id")] string VendorId);

    private sealed record OrderRowDto(
        [property: JsonPropertyName("id")] Guid Id,
        [property: JsonPropertyName("code")] string Code,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("vendor_id")] string VendorId,
        [property: JsonPropertyName("subtotal")] decimal Subtotal,
        [property: JsonPropertyName("total")] decimal Total,
        [property: JsonPropertyName("placed_at")] DateTimeOffset PlacedAt,
        [property: JsonPropertyName("accepted_at")] DateTimeOffset? AcceptedAt,
        [property: JsonPropertyName("ready_at")] DateTimeOffset? ReadyAt,
        [property: JsonPropertyName("completed_at")] DateTimeOffset? CompletedAt,
        [property: JsonPropertyName("cancelled_at")] DateTimeOffset? CancelledAt,
        [property: JsonPropertyName("cancel_reason")] string? CancelReason);

    private sealed record PostgrestError(
        [property: JsonPropertyName("code")] string? Code,
        [property: JsonPropertyName("message")] string? Message);

    private sealed record PlaceOrderRpcBody(
        [property: JsonPropertyName("p_student")] Guid Student,
        [property: JsonPropertyName("p_vendor")] string Vendor,
        [property: JsonPropertyName("p_subtotal")] decimal Subtotal,
        [property: JsonPropertyName("p_total")] decimal Total,
        [property: JsonPropertyName("p_pickup")] string Pickup,
        [property: JsonPropertyName("p_note")] string? Note,
        [property: JsonPropertyName("p_items")] IReadOnlyList<PlaceOrderRpcItem> Items);

    private sealed record PlaceOrderRpcItem(
        [property: JsonPropertyName("menu_item_id")] string MenuItemId,
        [property: JsonPropertyName("vendor_id")] string VendorId,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("unit_price")] decimal UnitPrice,
        [property: JsonPropertyName("qty")] int Qty);

    private sealed record TransitionRpcBody(
        [property: JsonPropertyName("p_id")] Guid Id,
        [property: JsonPropertyName("p_to")] string To,
        [property: JsonPropertyName("p_reason")] string? Reason);
}
