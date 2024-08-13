import { BigDecimal } from "@sentio/sdk";
import { EthContext } from "@sentio/sdk/eth";

import { getMswETHContractOnContext } from "./types/eth/msweth.js";
import { getRswETHContractOnContext } from "./types/eth/rsweth.js";

import { rswETH, mswETH } from "./constants.js";

export async function getEthExchangeRate(
    ctx: EthContext,
    token: string
): Promise<BigDecimal> {
    if (token === rswETH) {
        return (
            await getRswETHContractOnContext(ctx, rswETH).getRate()
        ).scaleDown(18);
    }

    if (token === rswETH) {
        return (
            await getMswETHContractOnContext(ctx, mswETH).exchangeRateToNative()
        ).scaleDown(18);
    }

    console.error("getExchangeRate unknown token", token);
    return BigDecimal(0);
}
