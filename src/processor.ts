import { getPriceByType, token } from "@sentio/sdk/utils";
import { BigDecimal, Counter, Gauge } from "@sentio/sdk";

import {
    CurveStableSwapNGContext,
    CurveStableSwapNGProcessor,
    AddLiquidityEvent,
    RemoveLiquidityEvent,
    TokenExchangeEvent,
    RemoveLiquidityImbalanceEvent,
    RemoveLiquidityOneEvent,
} from "./types/eth/curvestableswapng.js";

import {
    rswETH,
    mswETH,
    msw_rswETH_curve,
    msw_rswETH_curve_start_block,
} from "./constants.js";
import { getEthExchangeRate } from "./oracle.js";

//////////////////////////////

const rswETH_bal_acc = Counter.register("rswETH_bal_acc");
const mswETH_bal_acc = Counter.register("mswETH_bal_acc");

const rswETH_usd_acc = Gauge.register("rswETH_usd_acc");
const mswETH_usd_acc = Gauge.register("mswETH_usd_acc");

const rswETH_rate = Gauge.register("rswETH_rate");
const mswETH_rate = Gauge.register("mswETH_rate");

const rswETH_bal = Gauge.register("rswETH_bal");
const mswETH_bal = Gauge.register("mswETH_bal");

const addLiquidityHandler = async function (
    event: AddLiquidityEvent,
    ctx: CurveStableSwapNGContext
) {
    const mswETH_amt = event.args.token_amounts[0].scaleDown(18);
    const rswETH_amt = event.args.token_amounts[1].scaleDown(18);

    mswETH_bal_acc.add(ctx, mswETH_amt, { token: "mswETH" });
    rswETH_bal_acc.add(ctx, rswETH_amt, { token: "rswETH" });
};

const removeLiquidityHandler = async function (
    event: RemoveLiquidityEvent,
    ctx: CurveStableSwapNGContext
) {
    const mswETH_amt = event.args.token_amounts[0].scaleDown(18);
    const rswETH_amt = event.args.token_amounts[1].scaleDown(18);

    mswETH_bal_acc.sub(ctx, mswETH_amt, { token: "mswETH" });
    rswETH_bal_acc.sub(ctx, rswETH_amt, { token: "rswETH" });
};

const removeLiquidityImbalanceHandler = async function (
    event: RemoveLiquidityImbalanceEvent,
    ctx: CurveStableSwapNGContext
) {
    const mswETH_amt = event.args.token_amounts[0].scaleDown(18);
    const rswETH_amt = event.args.token_amounts[1].scaleDown(18);

    mswETH_bal_acc.sub(ctx, mswETH_amt, { token: "mswETH" });
    rswETH_bal_acc.sub(ctx, rswETH_amt, { token: "rswETH" });
};

const removeLiquidityOneHandler = async function (
    event: RemoveLiquidityOneEvent,
    ctx: CurveStableSwapNGContext
) {
    let mswETH_amt, rswETH_amt;
    if (event.args.token_id === BigInt(0)) {
        mswETH_amt = event.args.coin_amount.scaleDown(18);
        mswETH_bal_acc.sub(ctx, mswETH_amt, { token: "mswETH" });
    } else {
        rswETH_amt = event.args.coin_amount.scaleDown(18);
        rswETH_bal_acc.sub(ctx, rswETH_amt, { token: "rswETH" });
    }
};

const tokenExchangeHandler = async function (
    event: TokenExchangeEvent,
    ctx: CurveStableSwapNGContext
) {
    let mswETH_amt, rswETH_amt;
    if (event.args.sold_id === BigInt(0)) {
        mswETH_amt = event.args.tokens_sold.scaleDown(18);
        rswETH_amt = event.args.tokens_bought.scaleDown(18);
        mswETH_bal_acc.add(ctx, mswETH_amt, { token: "mswETH" });
        rswETH_bal_acc.sub(ctx, rswETH_amt, { token: "rswETH" });
    } else {
        mswETH_amt = event.args.tokens_bought.scaleDown(18);
        rswETH_amt = event.args.tokens_sold.scaleDown(18);
        mswETH_bal_acc.sub(ctx, mswETH_amt, { token: "mswETH" });
        rswETH_bal_acc.add(ctx, rswETH_amt, { token: "rswETH" });
    }

    const mswETH_exchangeRate = await getEthExchangeRate(ctx, mswETH);
    const rswETH_exchangeRate = await getEthExchangeRate(ctx, rswETH);

    mswETH_rate.record(ctx, mswETH_exchangeRate, { token: "mswETH" });
    rswETH_rate.record(ctx, rswETH_exchangeRate, { token: "rswETH" });
};

const blockHandler = async function (_: any, ctx: CurveStableSwapNGContext) {
    const [mswETH_bal_amt, rswETH_bal_amt] = (
        await ctx.contract.get_balances()
    ).flatMap((e) => e.scaleDown(18));

    mswETH_bal.record(ctx, mswETH_bal_amt, { token: "mswETH" });
    rswETH_bal.record(ctx, rswETH_bal_amt, { token: "rswETH" });

    const mswETH_exchangeRate = await getEthExchangeRate(ctx, mswETH);
    const rswETH_exchangeRate = await getEthExchangeRate(ctx, rswETH);

    mswETH_usd_acc.record(
        ctx,
        mswETH_bal_amt.multipliedBy(mswETH_exchangeRate),
        { token: "rswETH" }
    );
    rswETH_usd_acc.record(
        ctx,
        rswETH_bal_amt.multipliedBy(rswETH_exchangeRate),
        { token: "mswETH" }
    );
};

CurveStableSwapNGProcessor.bind({
    address: msw_rswETH_curve,
    startBlock: msw_rswETH_curve_start_block,
})
    .onEventAddLiquidity(addLiquidityHandler)
    .onEventRemoveLiquidity(removeLiquidityHandler)
    .onEventRemoveLiquidityImbalance(removeLiquidityImbalanceHandler)
    .onEventRemoveLiquidityOne(removeLiquidityOneHandler)
    .onEventTokenExchange(tokenExchangeHandler)
    .onBlockInterval(blockHandler);
