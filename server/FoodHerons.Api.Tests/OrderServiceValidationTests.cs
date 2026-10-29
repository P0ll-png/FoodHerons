using FoodHerons.Api.Dtos;
using FoodHerons.Api.Services;
using Xunit;

namespace FoodHerons.Api.Tests;

/// <summary>Input validation: pickupName bounds, note length, qty bounds, empty items, cancel-reason rules.</summary>
public class OrderServiceValidationTests
{
    private readonly OrderService _svc = new();

    private static PlaceOrderRequest Request(
        string vendorId = "v1",
        string pickupName = "Juan",
        string? note = null,
        LineItemDto[]? items = null) =>
        new(vendorId, pickupName, note, items ?? new[] { new LineItemDto("item-1", 1) });

    [Fact]
    public void Valid_request_passes()
    {
        Assert.Null(_svc.ValidatePlaceOrder(Request()));
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("A")]      // single char < 2
    public void PickupName_too_short_rejected(string name)
    {
        var error = _svc.ValidatePlaceOrder(Request(pickupName: name));
        Assert.NotNull(error);
        Assert.Equal(422, error!.Status);
        Assert.Equal("pickupName", error.Extensions!["field"]);
    }

    [Fact]
    public void PickupName_too_long_rejected()
    {
        var error = _svc.ValidatePlaceOrder(Request(pickupName: new string('x', 81)));
        Assert.NotNull(error);
        Assert.Equal("pickupName", error!.Extensions!["field"]);
    }

    [Fact]
    public void Note_over_280_rejected()
    {
        var error = _svc.ValidatePlaceOrder(Request(note: new string('n', 281)));
        Assert.NotNull(error);
        Assert.Equal("note", error!.Extensions!["field"]);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(100)]
    public void Qty_out_of_bounds_rejected(int qty)
    {
        var error = _svc.ValidatePlaceOrder(Request(items: new[] { new LineItemDto("item-1", qty) }));
        Assert.NotNull(error);
        Assert.Equal("items", error!.Extensions!["field"]);
    }

    [Fact]
    public void Empty_items_rejected()
    {
        var error = _svc.ValidatePlaceOrder(Request(items: Array.Empty<LineItemDto>()));
        Assert.NotNull(error);
        Assert.Equal("items", error!.Extensions!["field"]);
    }

    [Fact]
    public void Too_many_items_rejected()
    {
        var items = Enumerable.Range(0, 51).Select(i => new LineItemDto($"i{i}", 1)).ToArray();
        var error = _svc.ValidatePlaceOrder(Request(items: items));
        Assert.NotNull(error);
        Assert.Equal("items", error!.Extensions!["field"]);
    }

    [Fact]
    public void Missing_vendor_rejected()
    {
        var error = _svc.ValidatePlaceOrder(Request(vendorId: "  "));
        Assert.NotNull(error);
        Assert.Equal("vendorId", error!.Extensions!["field"]);
    }

    // ---- Transition body validation ----

    [Fact]
    public void Cancel_without_reason_rejected()
    {
        var error = _svc.ValidateTransition(new TransitionRequest("cancelled", null));
        Assert.NotNull(error);
        Assert.Equal(422, error!.Status);
        Assert.Equal("reason", error.Extensions!["field"]);
    }

    [Fact]
    public void Cancel_with_reason_passes()
    {
        Assert.Null(_svc.ValidateTransition(new TransitionRequest("cancelled", "Out of stock")));
    }

    [Fact]
    public void Reason_over_140_rejected()
    {
        var error = _svc.ValidateTransition(new TransitionRequest("cancelled", new string('r', 141)));
        Assert.NotNull(error);
        Assert.Equal("reason", error!.Extensions!["field"]);
    }

    [Fact]
    public void Forward_transition_with_reason_rejected()
    {
        var error = _svc.ValidateTransition(new TransitionRequest("preparing", "why"));
        Assert.NotNull(error);
        Assert.Equal("reason", error!.Extensions!["field"]);
    }

    [Fact]
    public void Forward_transition_without_reason_passes()
    {
        Assert.Null(_svc.ValidateTransition(new TransitionRequest("preparing", null)));
    }

    // ---- GCash payment transition reason rules ----

    [Fact]
    public void Reject_payment_without_reason_rejected()
    {
        // -> awaiting_payment (vendor/admin rejects the proof) requires a reason.
        var error = _svc.ValidateTransition(new TransitionRequest("awaiting_payment", null));
        Assert.NotNull(error);
        Assert.Equal(422, error!.Status);
        Assert.Equal("reason", error.Extensions!["field"]);
    }

    [Fact]
    public void Reject_payment_with_reason_passes()
    {
        Assert.Null(_svc.ValidateTransition(new TransitionRequest("awaiting_payment", "Reference not found")));
    }

    [Fact]
    public void Verify_payment_with_reason_rejected()
    {
        // The verify move (-> pending) forbids a reason.
        var error = _svc.ValidateTransition(new TransitionRequest("pending", "ok"));
        Assert.NotNull(error);
        Assert.Equal("reason", error!.Extensions!["field"]);
    }

    [Fact]
    public void Verify_payment_without_reason_passes()
    {
        Assert.Null(_svc.ValidateTransition(new TransitionRequest("pending", null)));
    }
}
