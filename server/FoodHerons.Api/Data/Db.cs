using FoodHerons.Api.Services;
using Npgsql;

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
/// The Npgsql-backed data layer. Connects with the service-role connection string
/// (ConnectionStrings:Postgres) and therefore bypasses RLS. All SQL is parameterized.
///
/// Pure order logic lives in <see cref="OrderService"/>; this class only moves rows.
/// It compiles and is constructable with no live DB (connections open lazily per call).
/// </summary>
public sealed class Db(NpgsqlDataSource dataSource)
{
    private readonly NpgsqlDataSource _dataSource = dataSource;

    /// <summary>Loads a vendor's placement-relevant fields, or null if it does not exist.</summary>
    public async Task<VendorInfo?> GetVendorAsync(string vendorId, CancellationToken ct)
    {
        const string sql = """
            select id, owner_id, preorder_enabled, hours_open, hours_close
            from public.vendors
            where id = @vendor_id
            """;

        await using var cmd = _dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue("vendor_id", vendorId);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new VendorInfo(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetGuid(1),
            reader.GetBoolean(2),
            reader.GetString(3),
            reader.GetString(4));
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

        const string sql = """
            select id, name, price, available
            from public.menu_items
            where vendor_id = @vendor_id and id = any(@ids)
            """;

        await using var cmd = _dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue("vendor_id", vendorId);
        cmd.Parameters.AddWithValue("ids", ids);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var id = reader.GetString(0);
            result[id] = new MenuItemInfo(id, reader.GetString(1), reader.GetDecimal(2), reader.GetBoolean(3));
        }
        return result;
    }

    /// <summary>
    /// Inserts an order + its items in a single transaction. The DB assigns the
    /// human-friendly <c>code</c> (sequence default) and <c>placed_at</c>; we omit
    /// both and use RETURNING. Status defaults to 'pending'.
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
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        Guid orderId;
        string code;
        DateTimeOffset placedAt;

        const string insertOrder = """
            insert into public.orders (student_id, vendor_id, subtotal, total, pickup_name, note)
            values (@student_id, @vendor_id, @subtotal, @total, @pickup_name, @note)
            returning id, code, placed_at
            """;

        await using (var cmd = new NpgsqlCommand(insertOrder, conn, tx))
        {
            cmd.Parameters.AddWithValue("student_id", studentId);
            cmd.Parameters.AddWithValue("vendor_id", vendorId);
            cmd.Parameters.AddWithValue("subtotal", subtotal);
            cmd.Parameters.AddWithValue("total", total);
            cmd.Parameters.AddWithValue("pickup_name", pickupName);
            cmd.Parameters.AddWithValue("note", (object?)note ?? DBNull.Value);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            orderId = reader.GetGuid(0);
            code = reader.GetString(1);
            placedAt = reader.GetFieldValue<DateTimeOffset>(2);
        }

        const string insertItem = """
            insert into public.order_items (order_id, menu_item_id, vendor_id, name, unit_price, qty)
            values (@order_id, @menu_item_id, @vendor_id, @name, @unit_price, @qty)
            """;

        foreach (var item in items)
        {
            await using var cmd = new NpgsqlCommand(insertItem, conn, tx);
            cmd.Parameters.AddWithValue("order_id", orderId);
            cmd.Parameters.AddWithValue("menu_item_id", item.MenuItemId);
            cmd.Parameters.AddWithValue("vendor_id", item.VendorId);
            cmd.Parameters.AddWithValue("name", item.Name);
            cmd.Parameters.AddWithValue("unit_price", item.UnitPrice);
            cmd.Parameters.AddWithValue("qty", item.Qty);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);

        return new OrderRow(orderId, code, OrderStatuses.Pending, vendorId, subtotal, total, placedAt,
            null, null, null, null, null);
    }

    /// <summary>
    /// Loads an order's current state under <c>FOR UPDATE</c>, or null if not found.
    /// Used inside <see cref="ApplyTransitionAsync"/>'s transaction to tie-break races.
    /// </summary>
    private static async Task<OrderState?> LoadForUpdateAsync(
        NpgsqlConnection conn, NpgsqlTransaction tx, Guid orderId, CancellationToken ct)
    {
        const string sql = """
            select id, status::text, student_id, vendor_id
            from public.orders
            where id = @id
            for update
            """;

        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        cmd.Parameters.AddWithValue("id", orderId);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new OrderState(reader.GetGuid(0), reader.GetString(1), reader.GetGuid(2), reader.GetString(3));
    }

    /// <summary>
    /// Loads an order's current state for pre-transition authorization/not-found checks.
    /// This is a non-locking read; the authoritative check happens under lock inside
    /// <see cref="ApplyTransitionAsync"/>.
    /// </summary>
    public async Task<OrderState?> GetOrderStateAsync(Guid orderId, CancellationToken ct)
    {
        const string sql = """
            select id, status::text, student_id, vendor_id
            from public.orders
            where id = @id
            """;

        await using var cmd = _dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue("id", orderId);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new OrderState(reader.GetGuid(0), reader.GetString(1), reader.GetGuid(2), reader.GetString(3));
    }

    /// <summary>
    /// Applies a validated transition atomically: re-reads status FOR UPDATE, re-plans
    /// against the current status (tie-break), and on success updates status + the
    /// matching lifecycle timestamp (+ cancel_reason for cancellations). Returns the
    /// updated row, or a <see cref="DomainError"/> if the transition became illegal.
    /// </summary>
    public async Task<Result<OrderRow>> ApplyTransitionAsync(
        OrderService orderService,
        Guid orderId,
        string to,
        string? reason,
        CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        var state = await LoadForUpdateAsync(conn, tx, orderId, ct);
        if (state is null)
            return Result<OrderRow>.Fail(new DomainError(404, "NOT_FOUND", "Order not found."));

        // Re-plan under the lock using the freshly-read status (lost-race safety).
        var plan = orderService.PlanTransition(state.Status, to);
        if (!plan.IsSuccess)
            return Result<OrderRow>.Fail(plan.Error!);

        var timestampColumn = to switch
        {
            OrderStatuses.Preparing => "accepted_at",
            OrderStatuses.Ready => "ready_at",
            OrderStatuses.Completed => "completed_at",
            OrderStatuses.Cancelled => "cancelled_at",
            _ => null
        };

        var setClauses = new List<string> { "status = @to::public.order_status" };
        if (timestampColumn is not null)
            setClauses.Add($"{timestampColumn} = now()");
        if (to == OrderStatuses.Cancelled)
            setClauses.Add("cancel_reason = @reason");

        var sql = $"""
            update public.orders
            set {string.Join(", ", setClauses)}
            where id = @id
            returning id, code, status::text, vendor_id, subtotal, total,
                      placed_at, accepted_at, ready_at, completed_at, cancelled_at, cancel_reason
            """;

        await using (var cmd = new NpgsqlCommand(sql, conn, tx))
        {
            cmd.Parameters.AddWithValue("id", orderId);
            cmd.Parameters.AddWithValue("to", to);
            if (to == OrderStatuses.Cancelled)
                cmd.Parameters.AddWithValue("reason", (object?)reason ?? DBNull.Value);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            var row = ReadOrderRow(reader);
            await reader.CloseAsync();
            await tx.CommitAsync(ct);
            return Result<OrderRow>.Ok(row);
        }
    }

    private static OrderRow ReadOrderRow(NpgsqlDataReader reader) => new(
        reader.GetGuid(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.GetDecimal(4),
        reader.GetDecimal(5),
        reader.GetFieldValue<DateTimeOffset>(6),
        reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
        reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8),
        reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9),
        reader.IsDBNull(10) ? null : reader.GetFieldValue<DateTimeOffset>(10),
        reader.IsDBNull(11) ? null : reader.GetString(11));
}
