use fips_mobile_core::api::echo_test;

#[tokio::test]
async fn echo_live() {
    if std::env::var("RUN_LIVE_MOBILE_ECHO").ok().as_deref() != Some("1") {
        return;
    }
    let relay = std::env::var("FIPS_TEST_RELAY")
        .unwrap_or_else(|_| "wss://fips.tomdwyer.uk".to_string());
    let server = std::env::var("FIPS_TEST_SERVER_NPUB").unwrap_or_else(|_| {
        "npub1ns6n8tsget5ezzrwj7es8hvn69yu2s5fcpq8xsutqgm5eddtjpes3n0kgq".to_string()
    });
    let result = echo_test(relay, server, 25_000).await;
    assert!(result.is_ok(), "echo failed: {result:?}");
    let echo = result.unwrap();
    assert!(echo.echo_roundtrip_ok, "echo not ok: {echo:?}");
}
