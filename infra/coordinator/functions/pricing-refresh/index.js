// Placeholder daily pricing-refresh handler. Real implementation that pulls
// from the Cloud Billing Catalog and writes Firestore /pricing snapshots
// lands with #38; this stub only exists so #35's Terraform has something to
// deploy and the Cloud Scheduler trigger can be smoke-tested end-to-end.
//
// HTTP-triggered gen-2 Cloud Function. Cloud Scheduler invokes it daily
// with an OIDC token (verified by Cloud Run's IAM layer before reaching
// this handler).

exports.refreshPricing = (req, res) => {
  console.log(
    JSON.stringify({
      msg: "pricing-refresh stub invoked",
      method: req.method,
      ts: new Date().toISOString(),
    }),
  );
  res.status(200).send("stub");
};
