const bs58 = require('bs58');
const web3 = require('@solana/web3.js');
const { searcherClient } = require('jito-ts/dist/sdk/block-engine/searcher');
const { Bundle } = require('jito-ts/dist/sdk/block-engine/types');
var Keypair = web3.Keypair;
var secret = process.env.PRIVATE_KEY;
if (!secret) {
  console.log('set PRIVATE_KEY first');
  process.exit(1);
}

const kp = Keypair.fromSecretKey(bs58.decode(secret));
const conn = new web3.Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
const HOST = process.env.BLOCK_ENGINE || 'tokyo.mainnet.block-engine.jito.wtf';
const EVERY = Number(process.env.EVERY_SEC || 20) * 1000;
const TIP = Number(process.argv[2] || 25000);

var stats = { sent: 0, ok: 0, bad: 0 };
var mine = {};
let client = searcherClient(HOST, kp);
let tipAccounts = [];

function printStats(label, id) {
  var rate = stats.sent ? ((stats.ok / stats.sent) * 100).toFixed(1) : '0.0';
  console.log(label + ' ' + id + ' | sent ' + stats.sent + ' ok ' + stats.ok + ' bad ' + stats.bad + ' rate ' + rate + '%');
}
client.onBundleResult(
  function (res) {
    var id = res.bundleId;
    if (!mine[id]) return;
    if (res.processed || res.finalized) {
      if (mine[id] === 'pending') {
        mine[id] = 'landed';
        stats.ok++;
      }
      printStats(res.processed ? 'processed' : 'finalized', id);
    } else if (res.rejected || res.dropped) {
      if (mine[id] === 'pending') {
        mine[id] = 'failed';
        stats.bad++;
      }
      printStats(res.rejected ? 'rejected' : 'dropped', id);
    } else if (res.accepted) {
      console.log('accepted ' + id + ' (not landed yet)');
    }
  },
  function (err) {
    console.log('stream error', err.message);
  }
);

function buildTx(blockhash) {
  var ix = web3.SystemProgram.transfer({
    fromPubkey: kp.publicKey,
    toPubkey: kp.publicKey,
    lamports: 1,
  });
  var msg = new web3.TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  var tx = new web3.VersionedTransaction(msg);
  tx.sign([kp]);
  return tx;
}

function sendOne() {
  return conn.getLatestBlockhash('confirmed').then(function (bh) {
    var tipKey = new web3.PublicKey(tipAccounts[Math.floor(Math.random() * tipAccounts.length)]);
    var b = new Bundle([buildTx(bh.blockhash)], 5);
    b = b.addTipTx(kp, TIP, tipKey, bh.blockhash);
    if (b instanceof Error) {
      throw b;
    }
    return client.sendBundle(b);
  }).then(function (r) {
    if (!r.ok) {
      stats.bad++;
      console.log('send failed', r.error.message);
      return;
    }
    mine[r.value] = 'pending';
    stats.sent++;
    console.log('sent ' + r.value);
  });
}

function loop() {
  sendOne()
    .catch(function (e) {
      console.log('loop error', e.message);
    })
    .then(function () {
      setTimeout(loop, EVERY);
    });
}
client.getTipAccounts().then(function (r) {
  if (!r.ok) {
    console.log('cant get tip accounts', r.error.message);
    process.exit(1);
  }
  tipAccounts = r.value;
  console.log('got ' + tipAccounts.length + ' tip accounts, starting');
  loop();
}).catch(function (e) {
  console.log(e);
  process.exit(1);
});
