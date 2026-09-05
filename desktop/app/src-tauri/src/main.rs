// Prevents a console window from opening alongside the app on Windows release builds.
// Debug builds keep it, because that is where the sidecar's stderr will be readable
// once there is a sidecar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pdf2code_desktop_lib::run()
}
