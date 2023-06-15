const axios = require("axios");
const ethers = require("ethers");
const { request, gql } = require("graphql-request");
const liquidityGaugeAbi = require("./constants/LiquidityGaugeAbi.json");

const POOL_ID =
  "0x4ab6f40241f01c9f6dcf8cc154d54b05477551c700010000000000000000001b";
const GAUGE_ADDRESS = "0xDE37F8a48C41F6C1A92Ac6792927F5151C7C4ba2";
const RPC_URL = "https://mainnet.aurora.dev";

const START_BLOCK = 94577299;

const SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/kyzooghost/balancer_aurora_fork";

const queryJoinExits = gql`
  query getJoinExits($poolId: String!, $first: Int!, $skip: Int!) {
    joinExits(first: $first, skip: $skip, where: { pool: $poolId }) {
      timestamp
      id
      type
      tx
      valueUSD
      user {
        id
      }
    }
  }
`;

exports.handler = async (event) => {
  const address = event.queryStringParameters.address; // Address is now provided by the event object.
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const START_TIMESTAMP = await provider
      .getBlock(START_BLOCK)
      .then((block) => block.timestamp);
    const gaugeContractForPool = new ethers.Contract(
      GAUGE_ADDRESS,
      liquidityGaugeAbi,
      provider
    );

    /*
  
      Check for joinPool events and compare total join amount to eth
  
    */

    let skip = 0;
    const first = 1000;
    let results = [];
    let keepGoing = true;

    while (keepGoing) {
      const variables = {
        poolId: POOL_ID,
        first,
        skip,
      };

      await request(SUBGRAPH_URL, queryJoinExits, variables)
        .then((data) => {
          results = results.concat(data.joinExits);
          if (data.joinExits.length < first) {
            keepGoing = false;
          } else {
            skip += first;
          }
        })
        .catch((err) => console.error(err));
    }
    const userResultsJoin = results.filter(
      (result) =>
        ethers.getAddress(result.user.id) === ethers.getAddress(address) &&
        result.type === "Join"
    );

    const totalJoinAmount = userResultsJoin.reduce(
      (acc, result) => acc + parseFloat(result.valueUSD),
      0
    );

    const ethPrice = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
    );

    const investmentThresholdSatisfied =
      ethPrice.data.ethereum.usd * 0.05 <= totalJoinAmount;

    /*
  
    Check for pool token staking
  
    */
    const events = await gaugeContractForPool.queryFilter(
      gaugeContractForPool.filters.Deposit(address),
      START_BLOCK,
      "latest"
    );
    const stakingEventsAfterTimestamp = events.filter(
      (event) => event.blockTimestamp >= START_TIMESTAMP
    );
    const userStakedBalance = await gaugeContractForPool.balanceOf(address);
    const doesUserHavePoolTokensStaked = userStakedBalance > BigInt(0);
    const hasStakedPoolTokens =
      doesUserHavePoolTokensStaked || stakingEventsAfterTimestamp.length > 0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        error: {
          code: 0,
          message: "",
        },
        data: {
          result: investmentThresholdSatisfied && hasStakedPoolTokens,
        },
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: {
          code: 500,
          message: error.message,
        },
        data: {
          result: false,
        },
      }),
    };
  }
};
