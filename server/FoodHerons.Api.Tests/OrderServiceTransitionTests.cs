using FoodHerons.Api.Dtos;
using FoodHerons.Api.Services;
using Xunit;

namespace FoodHerons.Api.Tests;

/// <summary>Transition state machine: legal forward moves allowed; skips/backward/terminal rejected.</summary>
public class OrderServiceTransitionTests
{
    private readonly OrderService _svc = new();

    [Theory]
    [InlineData("pending", "preparing")]
    [InlineData("preparing", "ready")]
    [InlineData("ready", "completed")]
    [InlineData("pending", "cancelled")]
    [InlineData("preparing", "cancelled")]
    // GCash-gated pre-order pairs.
    [InlineData("payment_submitted", "pending")]
    [InlineData("payment_submitted", "awaiting_payment")]
    [InlineData("awaiting_payment", "cancelled")]
    [InlineData("payment_submitted", "cancelled")]
    public void Legal_transitions_allowed(string from, string to)
    {
        var result = _svc.PlanTransition(from, to);
        Assert.True(result.IsSuccess);
        Assert.Equal(from, result.Value!.From);
        Assert.Equal(to, result.Value.To);
    }

    [Theory]
    // backward
    [InlineData("preparing", "pending")]
    [InlineData("ready", "preparing")]
    [InlineData("completed", "ready")]
    // skips
    [InlineData("pending", "ready")]
    [InlineData("pending", "completed")]
    [InlineData("preparing", "completed")]
    // out of terminal
    [InlineData("completed", "cancelled")]
    [InlineData("completed", "preparing")]
    [InlineData("cancelled", "pending")]
    [InlineData("cancelled", "preparing")]
    // ready cannot be cancelled
    [InlineData("ready", "cancelled")]
    // pre-payment states cannot skip verification into the active queue
    [InlineData("awaiting_payment", "preparing")]
    [InlineData("payment_submitted", "ready")]
    [InlineData("awaiting_payment", "completed")]
    public void Illegal_transitions_rejected(string from, string to)
    {
        var result = _svc.PlanTransition(from, to);
        Assert.False(result.IsSuccess);
        Assert.Equal(ErrorCodes.IllegalTransition, result.Error!.Code);
        Assert.Equal(409, result.Error.Status);
    }

    [Fact]
    public void Student_cancel_classified_only_from_pending()
    {
        var fromPending = _svc.PlanTransition("pending", "cancelled");
        Assert.True(fromPending.IsSuccess);
        Assert.Equal(TransitionKind.StudentCancel, fromPending.Value!.Kind);

        // From preparing, cancellation is a vendor action (reject), not a student cancel.
        var fromPreparing = _svc.PlanTransition("preparing", "cancelled");
        Assert.True(fromPreparing.IsSuccess);
        Assert.Equal(TransitionKind.VendorAction, fromPreparing.Value!.Kind);
    }

    [Theory]
    [InlineData("pending", "preparing")]
    [InlineData("preparing", "ready")]
    [InlineData("ready", "completed")]
    public void Forward_moves_classified_as_vendor_action(string from, string to)
    {
        var result = _svc.PlanTransition(from, to);
        Assert.True(result.IsSuccess);
        Assert.Equal(TransitionKind.VendorAction, result.Value!.Kind);
    }

    [Theory]
    [InlineData("payment_submitted", "pending")]
    [InlineData("payment_submitted", "awaiting_payment")]
    public void Payment_review_moves_classified_as_payment_review(string from, string to)
    {
        var result = _svc.PlanTransition(from, to);
        Assert.True(result.IsSuccess);
        Assert.Equal(TransitionKind.PaymentReview, result.Value!.Kind);
    }

    [Theory]
    [InlineData("awaiting_payment", "cancelled")]
    [InlineData("payment_submitted", "cancelled")]
    public void Pre_payment_cancels_classified_as_student_cancel(string from, string to)
    {
        var result = _svc.PlanTransition(from, to);
        Assert.True(result.IsSuccess);
        Assert.Equal(TransitionKind.StudentCancel, result.Value!.Kind);
    }

    [Fact]
    public void Invalid_target_status_rejected()
    {
        var result = _svc.PlanTransition("pending", "shipped");
        Assert.False(result.IsSuccess);
    }
}
