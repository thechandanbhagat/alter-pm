// @group IntegrationTests : Entry point for all integration tests in tests/integration/
// Cargo only discovers test files directly under tests/, so this file
// includes the subdirectory modules to make them part of the test binary.

#[path = "integration/daemon_lifecycle_test.rs"]
mod daemon_lifecycle_test;
