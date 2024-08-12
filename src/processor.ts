import { getPriceByType, token } from "@sentio/sdk/utils";
import { BigDecimal, Counter, Gauge } from "@sentio/sdk";

import {
    CurveStableSwapNGContext,
    CurveStableSwapNGProcessor,
    AddLiquidityEvent,
    RemoveLiquidityEvent,
    TokenExchangeEvent,
} from "./types/eth/curvestableswapng.js";

import { RswETHContext } from "./types/eth/rsweth.js";
import { MswETHContext } from "./types/eth/msweth.js";

import { rswETH, mswETH, msw_rswETH_curve } from "./util.js";

//////////////////////////////

const rswETH_bal_acc = Counter.register("rswETH_bal");
const mswETH_bal_acc = Counter.register("mswETH_bal");

const addLiquidityHandler = async function (
    event: AddLiquidityEvent,
    ctx: CurveStableSwapNGContext
) {
    const mswETH_amt = event.args.token_amounts[0].scaleDown(18);
    const rswETH_amt = event.args.token_amounts[1].scaleDown(18);

    mswETH_bal_acc.add(ctx, mswETH_amt, { token: "mswETH" });
    rswETH_bal_acc.add(ctx, rswETH_amt, { token: "mswETH" });
};

const removeLiquidityHandler = async function (
    event: RemoveLiquidityEvent,
    ctx: CurveStableSwapNGContext
) {
    const mswETH_amt = event.args.token_amounts[0].scaleDown(18);
    const rswETH_amt = event.args.token_amounts[1].scaleDown(18);

    mswETH_bal_acc.sub(ctx, mswETH_amt, { token: "mswETH" });
    rswETH_bal_acc.sub(ctx, rswETH_amt, { token: "mswETH" });
};

const tokenExchangeHandler = async function (
    event: TokenExchangeEvent,
    ctx: CurveStableSwapNGContext
) {
    let mswETH_amt, rswETH_amt;
    if (event.args.sold_id === BigInt(0)) {
        mswETH_amt = event.args.tokens_sold.scaleDown(18);
        rswETH_amt = event.args.tokens_bought.scaleDown(18);
    } else {
        mswETH_amt = event.args.tokens_bought.scaleDown(18);
        rswETH_amt = event.args.tokens_sold.scaleDown(18);
    }

    mswETH_bal_acc.sub(ctx, mswETH_amt, { token: "mswETH" });
    rswETH_bal_acc.sub(ctx, rswETH_amt, { token: "mswETH" });
};

CurveStableSwapNGProcessor.bind({ address: msw_rswETH_curve })
    .onEventAddLiquidity(addLiquidityHandler)
    .onEventRemoveLiquidity(removeLiquidityHandler)
    .onEventTokenExchange(tokenExchangeHandler);
