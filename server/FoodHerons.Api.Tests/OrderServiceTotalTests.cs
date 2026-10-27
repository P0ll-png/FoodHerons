using FoodHerons.Api.Dtos;
using FoodHerons.Api.Services;
using Xunit;

namespace FoodHerons.Api.Tests;

/// <summary>Total computation: server prices win, duplicates merge, unknown/unavailable -> ITEM_UNAVAILABLE.</summary>
public class OrderServiceTotalTests
{
    private readonly OrderService _svc = new();

    private static IReadOnlyDictionary<string, MenuItemInfo> Menu(params MenuItemInfo[] items) =>
        items.ToDictionary(i => i.MenuItemId, i => i, StringComparer.Ordinal);

    [Fact]
    public void ComputeOrder_uses_db_prices_and_sums_subtotal_equals_total()
    {
        var menu = Menu(
            new MenuItemInfo("tapsilog", "Tapsilog", 75.00m, true),
            new MenuItemInfo("iced-tea", "Iced Tea", 25.00m, true));

        var merged = new Dictionary<string, int> { ["tapsilog"] = 2, ["iced-tea"] = 1 };

        var result = _svc.ComputeOrder(merged, menu);

        Assert.True(result.IsSuccess);
        Assert.Equal(175.00m, result.Value!.Subtotal);
        Assert.Equal(175.00m, result.Value.Total);
        Assert.Equal(result.Value.Subtotal, result.Value.Total);
        Assert.Equal(2, result.Value.Lines.Count);
    }

    [Fact]
    public void Request_dto_has_no_price_field()
    {
        // Structural guarantee: LineItemDto exposes only MenuItemId + Qty.
        var props = typeof(LineItemDto).GetProperties().Select(p => p.Name).ToArray();
        Assert.Equal(new[] { "MenuItemId", "Qty" }, props);
        Assert.DoesNotContain(typeof(PlaceOrderRequest).GetProperties(),
            p => p.Name.Contains("price", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void MergeLines_sums_duplicate_ids()
    {
        var request = new PlaceOrderRequest("v1", "Juan Dela Cruz", null, new[]
        {
            new LineItemDto("tapsilog", 2),
            new LineItemDto("tapsilog", 3),
            new LineItemDto("iced-tea", 1),
        });

        var merged = OrderService.MergeLines(request);

        Assert.Equal(5, merged["tapsilog"]);
        Assert.Equal(1, merged["iced-tea"]);
    }

    [Fact]
    public void MergedDuplicates_price_the_combined_qty()
    {
        var menu = Menu(new MenuItemInfo("tapsilog", "Tapsilog", 75.00m, true));
        var merged = new Dictionary<string, int> { ["tapsilog"] = 5 };

        var result = _svc.ComputeOrder(merged, menu);

        Assert.True(result.IsSuccess);
        Assert.Equal(375.00m, result.Value!.Total);
        Assert.Single(result.Value.Lines);
        Assert.Equal(5, result.Value.Lines[0].Qty);
    }

    [Fact]
    public void Unknown_item_yields_ItemUnavailable()
    {
        var menu = Menu(new MenuItemInfo("tapsilog", "Tapsilog", 75.00m, true));
        var merged = new Dictionary<string, int> { ["ghost-item"] = 1 };

        var result = _svc.ComputeOrder(merged, menu);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorCodes.ItemUnavailable, result.Error!.Code);
        Assert.Equal(422, result.Error.Status);
    }

    [Fact]
    public void Unavailable_item_yields_ItemUnavailable()
    {
        var menu = Menu(new MenuItemInfo("tapsilog", "Tapsilog", 75.00m, false));
        var merged = new Dictionary<string, int> { ["tapsilog"] = 1 };

        var result = _svc.ComputeOrder(merged, menu);

        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorCodes.ItemUnavailable, result.Error!.Code);
    }
}
