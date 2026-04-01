use fips_mobile_core::api::bootstrap;

#[tokio::test]
async fn bootstrap_live() {
    if std::env::var("RUN_LIVE_MOBILE_BOOTSTRAP").ok().as_deref() != Some("1") {
        return;
    }
    let relay = std::env::var("FIPS_TEST_RELAY")
        .unwrap_or_else(|_| "wss://fips.tomdwyer.uk".to_string());
    let server = std::env::var("FIPS_TEST_SERVER_NPUB").unwrap_or_else(|_| {
        "npub1ns6n8tsget5ezzrwj7es8hvn69yu2s5fcpq8xsutqgm5eddtjpes3n0kgq".to_string()
    });
    let result = bootstrap(relay, server, 20_000, false).await;
    assert!(result.is_ok(), "bootstrap failed: {result:?}");
}
