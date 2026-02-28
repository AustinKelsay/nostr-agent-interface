const runNetworkTests = process.env.NOSTR_NETWORK_TESTS === "1";

const describeNetwork = runNetworkTests ? describe : describe.skip;
const testNetwork = runNetworkTests ? test : test.skip;

export { describeNetwork, testNetwork, runNetworkTests };
