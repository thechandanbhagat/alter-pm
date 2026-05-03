// @group UnitTests : Entry point for all unit tests in tests/unit/
// Cargo only discovers test files directly under tests/, so this file
// includes the subdirectory modules to make them part of the test binary.

#[path = "unit/restarter_test.rs"]
mod restarter_test;

#[path = "unit/config_parse_test.rs"]
mod config_parse_test;

#[path = "unit/api_types_test.rs"]
mod api_types_test;

#[path = "unit/process_info_test.rs"]
mod process_info_test;
