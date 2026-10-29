using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using FoodHerons.Api.Data;
using FoodHerons.Api.Services;
using Xunit;

namespace FoodHerons.Api.Tests;

/// <summary>
/// Unit tests for the Supabase HTTPS data layer (<see cref="Db"/>). A stub
/// <see cref="StubHttpMessageHandler"/> records the outgoing request and returns a
/// canned PostgREST response, so these run with no network and no Postgres. They pin
/// the PostgREST URL/header shape, the "missing menu id = absent from map" invariant,
/// the single-object (no array unwrap) RPC deserialization, the FH001/FH002 error
/// mapping keyed off the body `code` (not HTTP status), and the no-leak invariant.
/// </summary>
public class DbSupabaseTests
{
    private const string Base = "https://x.test/rest/v1/";

    private static Db MakeDb(StubHttpMessageHandler stub) =>
        new(new HttpClient(stub) { BaseAddress = new Uri(Base) });

    private static StubHttpMessageHandler Json(HttpStatusCode status, string body) =>
        new(status, body);

    // ===================================================================
    // GetVendorAsync
    // ===================================================================

    [Fact]
    public async Task GetVendorAsync_builds_expected_url_and_parses_row()
    {
        var stub = Json(HttpStatusCode.OK, """
            [{"id":"tita-nenas","owner_id":"22222222-2222-2222-2222-222222222222",
              "preorder_enabled":true,"hours_open":"08:00","hours_close":"20:00"}]
            """);
        var db = MakeDb(stub);

        var vendor = await db.GetVendorAsync("tita-nenas", default);

        Assert.NotNull(vendor);
        Assert.Equal("tita-nenas", vendor!.Id);
        Assert.Equal(Guid.Parse("22222222-2222-2222-2222-222222222222"), vendor.OwnerId);
        Assert.True(vendor.PreorderEnabled);
        Assert.Equal("08:00", vendor.HoursOpen);
        Assert.Equal("20:00", vendor.HoursClose);

        Assert.Equal(HttpMethod.Get, stub.LastRequest!.Method);
        var uri = stub.LastRequest.RequestUri!.ToString();
        Assert.Contains("/rest/v1/vendors?id=eq.tita-nenas", uri);
        Assert.Contains("select=id,owner_id,preorder_enabled,hours_open,hours_close", uri);
    }

    [Fact]
    public async Task GetVendorAsync_sends_apikey_and_bearer_headers()
    {
        var stub = Json(HttpStatusCode.OK, "[]");
        var http = new HttpClient(stub) { BaseAddress = new Uri(Base) };
        http.DefaultRequestHeaders.Add("apikey", "svc-key");
        http.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "svc-key");
        var db = new Db(http);

        await db.GetVendorAsync("v1", default);

        Assert.Equal("svc-key", stub.LastRequest!.Headers.GetValues("apikey").Single());
        Assert.Equal("Bearer", stub.LastRequest.Headers.Authorization!.Scheme);
        Assert.Equal("svc-key", stub.LastRequest.Headers.Authorization.Parameter);
    }

    [Fact]
    public async Task GetVendorAsync_returns_null_for_empty_array()
    {
        var db = MakeDb(Json(HttpStatusCode.OK, "[]"));
        Assert.Null(await db.GetVendorAsync("missing", default));
    }

    [Fact]
    public async Task GetVendorAsync_handles_null_owner_id()
    {
        var db = MakeDb(Json(HttpStatusCode.OK, """
            [{"id":"v1","owner_id":null,"preorder_enabled":false,"hours_open":"00:00","hours_close":"00:00"}]
            """));
        var vendor = await db.GetVendorAsync("v1", default);
        Assert.NotNull(vendor);
        Assert.Null(vendor!.OwnerId);
    }

    // ===================================================================
    // GetMenuItemsAsync
    // ===================================================================

    [Fact]
    public async Task GetMenuItemsAsync_builds_in_filter_and_maps_present_ids()
    {
        var stub = Json(HttpStatusCode.OK, """
            [{"id":"tapsilog","name":"Tapsilog","price":42.00,"available":true}]
            """);
        var db = MakeDb(stub);

        var map = await db.GetMenuItemsAsync("tita-nenas", new[] { "tapsilog", "longsilog" }, default);

        Assert.True(map.ContainsKey("tapsilog"));
        Assert.Equal(42.00m, map["tapsilog"].Price);
        // Missing id absent from the map (unavailable semantics).
        Assert.False(map.ContainsKey("longsilog"));

        var uri = Uri.UnescapeDataString(stub.LastRequest!.RequestUri!.ToString());
        Assert.Contains("menu_items?vendor_id=eq.tita-nenas", uri);
        Assert.Contains("id=in.(\"tapsilog\",\"longsilog\")", uri);
        Assert.Contains("select=id,name,price,available", uri);
    }

    [Fact]
    public async Task GetMenuItemsAsync_empty_input_short_circuits_without_http_call()
    {
        var stub = Json(HttpStatusCode.OK, "[]");
        var db = MakeDb(stub);

        var map = await db.GetMenuItemsAsync("v1", Array.Empty<string>(), default);

        Assert.Empty(map);
        Assert.Null(stub.LastRequest); // no HTTP call made
    }

    // ===================================================================
    // InsertOrderAsync (place_order RPC)
    // ===================================================================

    [Fact]
    public async Task InsertOrderAsync_posts_rpc_and_deserializes_single_object()
    {
        var stub = Json(HttpStatusCode.Created, """
            {"id":"33333333-3333-3333-3333-333333333333","code":"FH-000142","status":"pending",
             "vendor_id":"tita-nenas","subtotal":42.00,"total":42.00,
             "placed_at":"2026-10-27T05:26:27+00:00","accepted_at":null,"ready_at":null,
             "completed_at":null,"cancelled_at":null,"cancel_reason":null}
            """);
        var db = MakeDb(stub);

        var items = new List<OrderItemInput>
        {
            new("tapsilog", "tita-nenas", "Tapsilog", 42.00m, 1)
        };

        var row = await db.InsertOrderAsync(
            Guid.Parse("11111111-1111-1111-1111-111111111111"),
            "tita-nenas", 42.00m, 42.00m, "Juan", null, items, default);

        Assert.Equal("FH-000142", row.Code);
        Assert.Equal("pending", row.Status);
        Assert.Equal(42.00m, row.Total);
        Assert.Equal(DateTimeOffset.Parse("2026-10-27T05:26:27+00:00"), row.PlacedAt);
        Assert.Null(row.AcceptedAt);

        Assert.Equal(HttpMethod.Post, stub.LastRequest!.Method);
        Assert.Contains("rpc/place_order", stub.LastRequest.RequestUri!.ToString());

        using var sent = JsonDocument.Parse(stub.LastRequestBody!);
        var root = sent.RootElement;
        Assert.Equal("11111111-1111-1111-1111-111111111111", root.GetProperty("p_student").GetString());
        Assert.Equal("tita-nenas", root.GetProperty("p_vendor").GetString());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("p_note").ValueKind);
        var sentItems = root.GetProperty("p_items");
        Assert.Equal(1, sentItems.GetArrayLength());
        Assert.Equal("tapsilog", sentItems[0].GetProperty("menu_item_id").GetString());
        Assert.Equal(1, sentItems[0].GetProperty("qty").GetInt32());
    }

    [Fact]
    public async Task InsertOrderAsync_throws_on_non_2xx_without_leaking_body()
    {
        const string secret = "duplicate key value violates unique constraint orders_code_key";
        var db = MakeDb(Json(HttpStatusCode.BadRequest, $$"""{"code":"23505","message":"{{secret}}"}"""));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            db.InsertOrderAsync(Guid.NewGuid(), "v1", 1m, 1m, "Juan", null,
                new List<OrderItemInput> { new("x", "v1", "X", 1m, 1) }, default));

        Assert.DoesNotContain(secret, ex.Message);
        Assert.DoesNotContain("23505", ex.Message);
    }

    // ===================================================================
    // GetOrderStateAsync
    // ===================================================================

    [Fact]
    public async Task GetOrderStateAsync_parses_status_read()
    {
        var db = MakeDb(Json(HttpStatusCode.OK, """
            [{"id":"44444444-4444-4444-4444-444444444444","status":"pending",
              "student_id":"11111111-1111-1111-1111-111111111111","vendor_id":"tita-nenas"}]
            """));

        var state = await db.GetOrderStateAsync(Guid.Parse("44444444-4444-4444-4444-444444444444"), default);

        Assert.NotNull(state);
        Assert.Equal("pending", state!.Status);
        Assert.Equal("tita-nenas", state.VendorId);
    }

    [Fact]
    public async Task GetOrderStateAsync_returns_null_for_empty_array()
    {
        var db = MakeDb(Json(HttpStatusCode.OK, "[]"));
        Assert.Null(await db.GetOrderStateAsync(Guid.NewGuid(), default));
    }

    // ===================================================================
    // ApplyTransitionAsync (transition_order RPC)
    // ===================================================================

    private static readonly OrderService Svc = new();

    [Fact]
    public async Task ApplyTransitionAsync_success_returns_ok()
    {
        var stub = Json(HttpStatusCode.OK, """
            {"id":"55555555-5555-5555-5555-555555555555","code":"FH-000200","status":"preparing",
             "vendor_id":"tita-nenas","subtotal":42.00,"total":42.00,
             "placed_at":"2026-10-27T05:00:00+00:00","accepted_at":"2026-10-27T05:05:00+00:00",
             "ready_at":null,"completed_at":null,"cancelled_at":null,"cancel_reason":null}
            """);
        var db = MakeDb(stub);

        var actor = Guid.NewGuid();
        var result = await db.ApplyTransitionAsync(Svc, Guid.NewGuid(), "preparing", null, actor, default);

        Assert.True(result.IsSuccess);
        Assert.Equal("preparing", result.Value!.Status);
        Assert.NotNull(result.Value.AcceptedAt);

        Assert.Equal(HttpMethod.Post, stub.LastRequest!.Method);
        Assert.Contains("rpc/transition_order", stub.LastRequest.RequestUri!.ToString());
        using var sent = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal("preparing", sent.RootElement.GetProperty("p_to").GetString());
        Assert.Equal(actor.ToString(), sent.RootElement.GetProperty("p_actor").GetString());
    }

    [Fact]
    public async Task ApplyTransitionAsync_FH001_maps_to_illegal_transition()
    {
        var db = MakeDb(Json(HttpStatusCode.BadRequest, """{"code":"FH001","message":"illegal transition"}"""));

        var result = await db.ApplyTransitionAsync(Svc, Guid.NewGuid(), "completed", null, Guid.NewGuid(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorCodes.IllegalTransition, result.Error!.Code);
        Assert.Equal(409, result.Error.Status);
    }

    [Fact]
    public async Task ApplyTransitionAsync_FH002_maps_to_not_found()
    {
        var db = MakeDb(Json(HttpStatusCode.BadRequest, """{"code":"FH002","message":"order not found"}"""));

        var result = await db.ApplyTransitionAsync(Svc, Guid.NewGuid(), "preparing", null, Guid.NewGuid(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal("NOT_FOUND", result.Error!.Code);
        Assert.Equal(404, result.Error.Status);
    }

    [Fact]
    public async Task ApplyTransitionAsync_maps_FH001_regardless_of_http_status()
    {
        // Pins Finding 6: mapping keys off the body `code`, not the HTTP status.
        // Here a non-400 (500) status still carries an FH001 body.
        var db = MakeDb(Json(HttpStatusCode.InternalServerError, """{"code":"FH001","message":"illegal"}"""));

        var result = await db.ApplyTransitionAsync(Svc, Guid.NewGuid(), "completed", null, Guid.NewGuid(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorCodes.IllegalTransition, result.Error!.Code);
    }

    [Fact]
    public async Task ApplyTransitionAsync_unknown_error_code_throws()
    {
        var db = MakeDb(Json(HttpStatusCode.BadRequest, """{"code":"23514","message":"check violation"}"""));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            db.ApplyTransitionAsync(Svc, Guid.NewGuid(), "preparing", null, Guid.NewGuid(), default));
    }

    [Fact]
    public async Task ApplyTransitionAsync_unparseable_error_body_throws()
    {
        var db = MakeDb(Json(HttpStatusCode.BadGateway, "<html>502</html>"));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            db.ApplyTransitionAsync(Svc, Guid.NewGuid(), "preparing", null, Guid.NewGuid(), default));
    }

    // ===================================================================
    // SubmitPaymentAsync (submit_payment RPC)
    // ===================================================================

    [Fact]
    public async Task SubmitPaymentAsync_success_returns_ok()
    {
        var stub = Json(HttpStatusCode.OK, """
            {"id":"66666666-6666-6666-6666-666666666666","code":"FH-000300","status":"payment_submitted",
             "vendor_id":"tita-nenas","subtotal":42.00,"total":42.00,
             "placed_at":"2026-10-27T05:00:00+00:00","accepted_at":null,"ready_at":null,
             "completed_at":null,"cancelled_at":null,"cancel_reason":null,
             "gcash_reference":"1234 5678","payment_submitted_at":"2026-10-27T05:10:00+00:00",
             "payment_verified_at":null,"payment_rejected_reason":null,
             "payment_screenshot_path":"66666666-6666-6666-6666-666666666666/proof.jpg"}
            """);
        var db = MakeDb(stub);

        var orderId = Guid.Parse("66666666-6666-6666-6666-666666666666");
        var result = await db.SubmitPaymentAsync(orderId, "1234 5678",
            "66666666-6666-6666-6666-666666666666/proof.jpg", default);

        Assert.True(result.IsSuccess);
        Assert.Equal("payment_submitted", result.Value!.Status);
        Assert.Equal("1234 5678", result.Value.GcashReference);
        Assert.NotNull(result.Value.PaymentSubmittedAt);

        Assert.Equal(HttpMethod.Post, stub.LastRequest!.Method);
        Assert.Contains("rpc/submit_payment", stub.LastRequest.RequestUri!.ToString());
        using var sent = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal(orderId.ToString(), sent.RootElement.GetProperty("p_id").GetString());
        Assert.Equal("1234 5678", sent.RootElement.GetProperty("p_reference").GetString());
        Assert.Equal("66666666-6666-6666-6666-666666666666/proof.jpg",
            sent.RootElement.GetProperty("p_screenshot_path").GetString());
    }

    [Fact]
    public async Task SubmitPaymentAsync_FH001_maps_to_illegal_transition()
    {
        var db = MakeDb(Json(HttpStatusCode.BadRequest, """{"code":"FH001","message":"not awaiting payment"}"""));

        var result = await db.SubmitPaymentAsync(Guid.NewGuid(), "1234", null, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorCodes.IllegalTransition, result.Error!.Code);
        Assert.Equal(409, result.Error.Status);
    }

    [Fact]
    public async Task SubmitPaymentAsync_FH002_maps_to_not_found()
    {
        var db = MakeDb(Json(HttpStatusCode.BadRequest, """{"code":"FH002","message":"order not found"}"""));

        var result = await db.SubmitPaymentAsync(Guid.NewGuid(), "1234", null, default);

        Assert.False(result.IsSuccess);
        Assert.Equal("NOT_FOUND", result.Error!.Code);
        Assert.Equal(404, result.Error.Status);
    }

    // ===================================================================
    // Legal-set sync test (SQL whitelist mirrors OrderService.Legal)
    // ===================================================================

    [Fact]
    public void LegalTransitionSet_matches_sql_whitelist()
    {
        // The 9 pairs copied verbatim from supabase/migrations/0010_order_payment.sql
        // transition_order's whitelist (the create-or-replace that now carries the
        // effective set). A mismatch with OrderService.Legal fails here.
        var sqlWhitelist = new HashSet<(string From, string To)>
        {
            ("pending",           "preparing"),
            ("preparing",         "ready"),
            ("ready",             "completed"),
            ("pending",           "cancelled"),
            ("preparing",         "cancelled"),
            ("payment_submitted", "pending"),
            ("payment_submitted", "awaiting_payment"),
            ("awaiting_payment",  "cancelled"),
            ("payment_submitted", "cancelled"),
        };

        // The C# authority: assert every SQL pair is accepted by OrderService and
        // that OrderService rejects representative non-legal pairs, so the two agree.
        foreach (var (from, to) in sqlWhitelist)
            Assert.True(Svc.PlanTransition(from, to).IsSuccess, $"OrderService should allow {from}->{to}");

        // Representative illegal pairs (pre-payment skips) must be rejected.
        var illegalSamples = new[]
        {
            ("awaiting_payment", "preparing"),
            ("payment_submitted", "ready"),
            ("awaiting_payment", "completed"),
        };
        foreach (var (from, to) in illegalSamples)
        {
            Assert.False(sqlWhitelist.Contains((from, to)), $"SQL whitelist must not contain {from}->{to}");
            Assert.False(Svc.PlanTransition(from, to).IsSuccess, $"OrderService should reject {from}->{to}");
        }
    }
}

/// <summary>Records the outgoing request (and its body) and returns a canned response.</summary>
public sealed class StubHttpMessageHandler : HttpMessageHandler
{
    private readonly HttpStatusCode _status;
    private readonly string _body;

    public StubHttpMessageHandler(HttpStatusCode status, string body)
    {
        _status = status;
        _body = body;
    }

    public HttpRequestMessage? LastRequest { get; private set; }
    public string? LastRequestBody { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastRequest = request;
        if (request.Content is not null)
            LastRequestBody = await request.Content.ReadAsStringAsync(cancellationToken);

        return new HttpResponseMessage(_status)
        {
            Content = new StringContent(_body, Encoding.UTF8, "application/json")
        };
    }
}
