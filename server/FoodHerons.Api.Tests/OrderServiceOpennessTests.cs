using FoodHerons.Api.Services;
using Xunit;

namespace FoodHerons.Api.Tests;

/// <summary>Asia/Manila openness (fixed UTC+8): normal window, overnight-wrap, and '00:00'/'00:00' closed.</summary>
public class OrderServiceOpennessTests
{
    private readonly OrderService _svc = new();

    // Helper: build a UTC instant that is a given Manila wall-clock time.
    private static DateTimeOffset ManilaWallClock(int hour, int minute) =>
        new DateTimeOffset(2026, 1, 15, hour, minute, 0, OrderService.ManilaOffset).ToUniversalTime();

    [Theory]
    [InlineData(9, 0, true)]    // 09:00 inside 08:00-17:00
    [InlineData(8, 0, true)]    // boundary open-inclusive
    [InlineData(16, 59, true)]  // just before close
    public void Normal_window_open(int h, int m, bool expected)
    {
        Assert.Equal(expected, _svc.IsOpenNow("08:00", "17:00", ManilaWallClock(h, m)));
    }

    [Theory]
    [InlineData(7, 59, false)]  // before open
    [InlineData(17, 0, false)]  // close is exclusive
    [InlineData(22, 0, false)]  // well after close
    public void Normal_window_closed(int h, int m, bool expected)
    {
        Assert.Equal(expected, _svc.IsOpenNow("08:00", "17:00", ManilaWallClock(h, m)));
    }

    [Theory]
    [InlineData(23, 0, true)]   // late night, before midnight
    [InlineData(1, 0, true)]    // early morning, after midnight
    [InlineData(22, 0, true)]   // boundary open-inclusive
    [InlineData(1, 59, true)]   // just before close
    public void Overnight_wrap_open_on_both_sides(int h, int m, bool expected)
    {
        // 22:00 -> 02:00 window spans midnight.
        Assert.Equal(expected, _svc.IsOpenNow("22:00", "02:00", ManilaWallClock(h, m)));
    }

    [Theory]
    [InlineData(21, 59, false)] // before open
    [InlineData(2, 0, false)]   // close is exclusive
    [InlineData(12, 0, false)]  // midday, closed
    public void Overnight_wrap_closed(int h, int m, bool expected)
    {
        Assert.Equal(expected, _svc.IsOpenNow("22:00", "02:00", ManilaWallClock(h, m)));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(12, 0)]
    [InlineData(23, 59)]
    public void Zero_hours_always_closed(int h, int m)
    {
        Assert.False(_svc.IsOpenNow("00:00", "00:00", ManilaWallClock(h, m)));
    }

    [Fact]
    public void Uses_fixed_utc_plus_8_not_utc()
    {
        // 18:00 UTC == 02:00 next day in Manila. With a 22:00-02:00 window, Manila
        // time is closed at exactly 02:00 (exclusive) but a naive UTC check (18:00)
        // would be closed too; pick 17:30 UTC == 01:30 Manila which must be OPEN.
        var utc = new DateTimeOffset(2026, 1, 15, 17, 30, 0, TimeSpan.Zero);
        Assert.True(_svc.IsOpenNow("22:00", "02:00", utc));
    }
}
