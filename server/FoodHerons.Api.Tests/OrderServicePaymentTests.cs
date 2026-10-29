using FoodHerons.Api.Dtos;
using FoodHerons.Api.Services;
using Xunit;

namespace FoodHerons.Api.Tests;

/// <summary>
/// Pure submit-payment body validation (design §4.4/§4.6): gcashReference is
/// required, trimmed to 4-40 chars, digits/spaces/hyphens only; screenshotPath
/// is optional here (its shape/route-id check lives at the endpoint, not here).
/// </summary>
public class OrderServicePaymentTests
{
    private readonly OrderService _svc = new();

    [Fact]
    public void Valid_reference_passes()
    {
        Assert.Null(_svc.ValidateSubmitPayment(new SubmitPaymentRequest("1234 5678", null)));
    }

    [Fact]
    public void Valid_reference_with_screenshot_passes()
    {
        // screenshotPath is NOT checked by the pure validator — any value is fine here.
        Assert.Null(_svc.ValidateSubmitPayment(new SubmitPaymentRequest("1234567890", "anything")));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Missing_reference_rejected(string? reference)
    {
        var error = _svc.ValidateSubmitPayment(new SubmitPaymentRequest(reference, null));
        Assert.NotNull(error);
        Assert.Equal(422, error!.Status);
        Assert.Equal("gcashReference", error.Extensions!["field"]);
    }

    [Theory]
    [InlineData("123")]       // 3 chars < min 4
    public void Reference_too_short_rejected(string reference)
    {
        var error = _svc.ValidateSubmitPayment(new SubmitPaymentRequest(reference, null));
        Assert.NotNull(error);
        Assert.Equal("gcashReference", error!.Extensions!["field"]);
    }

    [Fact]
    public void Reference_too_long_rejected()
    {
        var error = _svc.ValidateSubmitPayment(new SubmitPaymentRequest(new string('1', 41), null));
        Assert.NotNull(error);
        Assert.Equal("gcashReference", error!.Extensions!["field"]);
    }

    [Theory]
    [InlineData("12ab34")]    // letters not allowed
    [InlineData("1234$567")]  // symbol not allowed
    public void Reference_with_disallowed_chars_rejected(string reference)
    {
        var error = _svc.ValidateSubmitPayment(new SubmitPaymentRequest(reference, null));
        Assert.NotNull(error);
        Assert.Equal("gcashReference", error!.Extensions!["field"]);
    }

    [Theory]
    [InlineData("1234")]
    [InlineData("1234 5678 9012")]
    [InlineData("1234-5678")]
    public void Reference_digits_spaces_hyphens_allowed(string reference)
    {
        Assert.Null(_svc.ValidateSubmitPayment(new SubmitPaymentRequest(reference, null)));
    }
}
