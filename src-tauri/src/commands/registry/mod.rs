mod system;
mod account;
mod game;
mod media;
mod bedrock;
mod server;
mod content;
mod platform;
mod sets;
mod storage;
mod services;

pub(crate) use system::system_commands;
pub(crate) use account::account_commands;
pub(crate) use game::game_commands;
pub(crate) use media::media_commands;
pub(crate) use bedrock::bedrock_commands;
pub(crate) use server::server_commands;
pub(crate) use content::content_commands;
pub(crate) use platform::platform_commands;
pub(crate) use sets::sets_commands;
pub(crate) use storage::storage_commands;
pub(crate) use services::services_commands;

macro_rules! invoke_handler {
    () => {
        $crate::commands::registry::system_commands!([]
            account_commands
            game_commands
            media_commands
            bedrock_commands
            server_commands
            content_commands
            platform_commands
            sets_commands
            storage_commands
            services_commands
            finish)
    };
}

macro_rules! finish {
    ([$($acc:tt)*]) => {
        ::tauri::generate_handler![$($acc)*]
    };
}

pub(crate) use {finish, invoke_handler};
