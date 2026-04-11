// @group Configuration : Build script — forward GH_OAUTH_CLIENT_ID to the compiler
//
// Set GH_OAUTH_CLIENT_ID in your environment (or in a .env.build file loaded by your
// build wrapper) before running `cargo build`. The value is baked into the binary
// at compile time via option_env!("GH_OAUTH_CLIENT_ID") in src/api/routes/ai.rs.
//
// Example:
//   GH_OAUTH_CLIENT_ID=Ov23liXXXXXXXXXXXXXX cargo build --release

fn main() {
    // Re-run this script only when GH_OAUTH_CLIENT_ID changes (not on every build)
    println!("cargo:rerun-if-env-changed=GH_OAUTH_CLIENT_ID");
}
