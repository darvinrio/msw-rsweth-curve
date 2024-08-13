import { AccountSnapshot } from "./schema/schema.js";

import { GLOBAL_CONFIG } from "@sentio/runtime";
import { BigDecimal } from "@sentio/sdk";
import { EthChainId, isNullAddress } from "@sentio/sdk/eth";
import { getPriceBySymbol } from "@sentio/sdk/utils";

import {
    CurveStableSwapNGContext,
    CurveStableSwapNGProcessor,
} from "./types/eth/curvestableswapng.js";
import {
    GAUGE_ADDRESS,
    GAUGE_EXISTS,
    GAUGE_START_BLOCK,
    MELLOW_MULTIPLIER,
    NETWORK,
    POINTS_PER_HOUR,
    POOL_ADDRESS,
    PEARL_PER_ETH_PER_DAY,
    EL_PER_RSW_PER_DAY,
} from "./config.js";

import { rswETH, mswETH } from "./constants.js";

import { getEthExchangeRate } from "./oracle.js";

const MILLISECOND_PER_HOUR = 60 * 60 * 1000;
const MILLISECOND_PER_DAY = 24 * 60 * 60 * 1000;
const TOKEN_DECIMALS = 18;

GLOBAL_CONFIG.execution = {
    sequential: true,
};

CurveStableSwapNGProcessor.bind({
    address: POOL_ADDRESS,
    network: NETWORK,
})
    .onEventAddLiquidity(async (event, ctx) => {
        const accountAddress = event.args.provider;
        const accounts = [accountAddress].filter(
            (account) => !isNullAddress(account)
        );
        await Promise.all(
            accounts.map((account) => processAccount(ctx, account, event.name))
        );
    })
    .onEventRemoveLiquidity(async (event, ctx) => {
        const accountAddress = event.args.provider;
        const accounts = [accountAddress].filter(
            (account) => !isNullAddress(account)
        );
        await Promise.all(
            accounts.map((account) => processAccount(ctx, account, event.name))
        );
    })
    .onEventTokenExchange(async (event, ctx) => {
        const accountSnapshots = await ctx.store.list(AccountSnapshot, []);
        await Promise.all(
            accountSnapshots.map((snapshot) => {
                //check corresponding pool only
                if (snapshot.id.includes(ctx.address))
                    return processAccount(ctx, snapshot.id, "TimeInterval");
                return Promise.resolve();
            })
        );
    })
    .onEventTransfer(async (event, ctx) => {
        const accounts = [event.args.sender, event.args.receiver];

        // we only handle the case where people transfer LPTs to each other.
        if (accounts.some(isProtocolAddress)) {
            return;
        }

        await Promise.all(
            accounts.map((account) => processAccount(ctx, account, event.name))
        );
    })
    .onTimeInterval(
        async (_, ctx) => {
            const accountSnapshots = await ctx.store.list(AccountSnapshot, []);
            await Promise.all(
                accountSnapshots.map((snapshot) => {
                    //check corresponding pool only
                    if (snapshot.id.includes(ctx.address))
                        return processAccount(ctx, snapshot.id, "TimeInterval");
                    return Promise.resolve();
                })
            );
        },
        4 * 60,
        4 * 60
    );

async function processAccount(
    ctx: CurveStableSwapNGContext,
    accountAddress: string,
    triggerEvent: string
) {
    const accountSnapshot = await ctx.store.get(
        AccountSnapshot,
        `${accountAddress}`
    );
    const [pearls, elPoints] = accountSnapshot
        ? await calcPoints(ctx, accountSnapshot)
        : [new BigDecimal(0), new BigDecimal(0), new BigDecimal(0)];

    const latestAccountSnapshot = await getLatestAccountSnapshot(
        ctx,
        accountAddress
    );

    const newAccountSnapshot = new AccountSnapshot(latestAccountSnapshot);
    await ctx.store.upsert(newAccountSnapshot);

    ctx.eventLogger.emit("point_update", {
        account: accountAddress,
        triggerEvent,
        pearls,
        elPoints,
        snapshotTimestampMilli: accountSnapshot?.timestampMilli ?? 0,
        snapshotLptBalance: accountSnapshot?.lptBalance ?? "0",
        snapshotLptSupply: accountSnapshot?.lptSupply ?? "0",
        snapshotMswEthBalance: accountSnapshot?.poolMswEthBalance ?? "0",
        snapshotPoolRswEthBalance: accountSnapshot?.poolRswEthBalance ?? "0",
        newTimestampMilli: latestAccountSnapshot.timestampMilli,
        newLptBalance: latestAccountSnapshot.lptBalance,
        newLptSupply: latestAccountSnapshot.lptSupply,
        newPoolMswEthBalance: latestAccountSnapshot.poolMswEthBalance,
        newPoolRswEthBalance: latestAccountSnapshot.poolRswEthBalance,
    });
}

async function calcPoints(
    ctx: CurveStableSwapNGContext,
    accountSnapshot: AccountSnapshot
): Promise<[BigDecimal, BigDecimal]> {
    const nowMilli = ctx.timestamp.getTime();
    if (nowMilli < Number(accountSnapshot.timestampMilli)) {
        console.error(
            "unexpected account snapshot from the future",
            nowMilli,
            accountSnapshot
        );
        return [new BigDecimal(0), new BigDecimal(0)];
    } else if (nowMilli == Number(accountSnapshot.timestampMilli)) {
        // account affected for multiple times in the block
        return [new BigDecimal(0), new BigDecimal(0)];
    }
    const deltaHour =
        (nowMilli - Number(accountSnapshot.timestampMilli)) /
        MILLISECOND_PER_HOUR;
    const deltaDate =
        (nowMilli - Number(accountSnapshot.timestampMilli)) /
        MILLISECOND_PER_DAY;

    const { lptBalance, lptSupply, poolRswEthBalance, poolMswEthBalance } =
        accountSnapshot;

    const poolShare = BigInt(lptBalance)
        .asBigDecimal()
        .div(BigInt(lptSupply).asBigDecimal());

    const accountRswEthBalance = poolShare.multipliedBy(
        BigInt(poolRswEthBalance).scaleDown(TOKEN_DECIMALS)
    );
    const accountMswEthBalance = poolShare.multipliedBy(
        BigInt(poolMswEthBalance).scaleDown(TOKEN_DECIMALS)
    );

    // TODO: replace to MswEth price
    const ethPrice = await getPriceBySymbol("ETH", ctx.timestamp);
    const mswETH_exchangeRate = await getEthExchangeRate(ctx, mswETH);
    const rswETH_exchangeRate = await getEthExchangeRate(ctx, rswETH);

    if (!ethPrice) {
        throw new Error(`can't get eth price at ${ctx.blockNumber}`);
    }
    if (!mswETH_exchangeRate || !rswETH_exchangeRate) {
        throw new Error(`can't get token price at ${ctx.blockNumber}`);
    }

    const RswPearls = accountRswEthBalance
        // .multipliedBy(deltaHour)
        .multipliedBy(deltaDate)
        // .multipliedBy(ethPrice)
        .multipliedBy(rswETH_exchangeRate)
        .multipliedBy(PEARL_PER_ETH_PER_DAY)
        .multipliedBy(MELLOW_MULTIPLIER);

    const MswPearls = accountMswEthBalance
        // .multipliedBy(deltaHour)
        .multipliedBy(deltaDate)
        // .multipliedBy(ethPrice)
        .multipliedBy(mswETH_exchangeRate)
        .multipliedBy(PEARL_PER_ETH_PER_DAY)
        .multipliedBy(MELLOW_MULTIPLIER);

    const pearls = RswPearls.plus(MswPearls)

    const elPoints = accountRswEthBalance
        // .multipliedBy(deltaHour)
        .multipliedBy(deltaDate)
        // .multipliedBy(ethPrice)
        .multipliedBy(EL_PER_RSW_PER_DAY);

    return [pearls, elPoints];
}

async function getLatestAccountSnapshot(
    ctx: CurveStableSwapNGContext,
    accountAddress: string
) {
    let lptBalance = await ctx.contract.balanceOf(accountAddress);
    // if (GAUGE_EXISTS && ctx.blockNumber > GAUGE_START_BLOCK) {
    //     const gaugeContract = getCurveGaugeContractOnContext(
    //         ctx,
    //         GAUGE_ADDRESS
    //     );
    //     lptBalance += await gaugeContract.balanceOf(accountAddress);

    //     const gaugeBal = await gaugeContract.balanceOf(accountAddress);
    //     console.log("gaugeContract balance", ctx.blockNumber, gaugeBal);
    // }
    const lptSupply = await ctx.contract.totalSupply();
    const poolRswEthBalance = await ctx.contract.balances(0);
    const poolMswEthBalance = await ctx.contract.balances(1);

    return {
        id: `${accountAddress}`,
        timestampMilli: BigInt(ctx.timestamp.getTime()),
        lptBalance: lptBalance.toString(),
        lptSupply: lptSupply.toString(),
        poolRswEthBalance: poolRswEthBalance.toString(),
        poolMswEthBalance: poolMswEthBalance.toString(),
    };
}

function isProtocolAddress(address: string): boolean {
    return (
        isNullAddress(address) ||
        address === POOL_ADDRESS ||
        (GAUGE_EXISTS && address === GAUGE_ADDRESS)
    );
}
