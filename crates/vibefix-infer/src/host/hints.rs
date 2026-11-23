use std::sync::LazyLock;

use super::pyre::Py;

pub struct Hint {
    pub cause: &'static str,
    pub pattern: Py,
    pub confidence: f64,
    pub fatal: bool,
    pub names: Vec<String>,
}

fn hint(cause: &'static str, pattern: &str, confidence: f64, fatal: bool) -> Hint {
    let pattern = Py::new(&format!("(?i){pattern}"));
    let names = pattern.names();
    Hint { cause, pattern, confidence, fatal, names }
}

#[rustfmt::skip]
pub static HINTS: LazyLock<Vec<Hint>> = LazyLock::new(|| {
    vec![
        hint("disabled_dependency", r##"\b(?:[Ii]gnoring|[Ff]ound) disabled (?:mod )?file (?:mods[/\\])?(?P<file>[^/\\]+\.jar\.disabled)\b"##, 0.86, true),
        hint("loader_files", r##"(?:NoSuchFileException|FileNotFoundException):\s*(?P<file>.*?[/\\]?(?:fabric(?:-loader)?|quilt(?:-loader)?|neoforge|forge|modlauncher)[-/\\][^\r\n]*?\.jar)\b"##, 0.9, true),
        hint("forge_mod_on_fabric", r##"File (?P<file>[^\n]+?\.jar) is a (?:Minecraft )?Forge mod and cannot be loaded"##, 0.96, true),
        hint("connector_transform", r##"(?:org\.sinytra\.connector\.[\w.$]+(?:Exception|Error)|Sinytra Connector).*?(?:Failed to transform|Error transforming)\s+(?P<file>\S+\.jar)(?: for mod (?P<mod_id>[\w.-]+))?"##, 0.9, true),
        hint("connector_dependency", r##"\bMod (?:Sinytra )?Connector requires (?:mod )?(?P<dep_id>forgified[_ -]fabric[_ -]api|fabric[_ -]api)(?: (?P<range>[\d.]+))?"##, 0.9, true),
        hint("mixin_target_missing", r##"(?:InvalidInjectionException|InvalidMixinException|MixinApplyError).*?(?:could not find any targets|target class [\w.$/]+ was not found|unable to locate target method)(?:.*?\bin (?P<class>[\w.$/]+))?"##, 0.92, true),
        hint("mixin_target_missing", r##"@(?:Shadow|Overwrite|Accessor|Invoker) (?:method|field) \S+ in \S+?(?: from mod (?P<mod_id>[\w.-]+))? was not located in the target class (?P<class>[\w.$/]+?)\.?(?:\s|$)"##, 0.9, true),
        hint("mixin_target_missing", r##"(?:InvalidInjectionException|Critical injection failure).*?(?: from mod (?P<mod_id>[\w.-]+))? failed injection check, \(0/\d+\) succeeded\. Scanned 0 target\(s\)"##, 0.88, true),
        hint("missing_class", r##"java\.lang\.(?:NoClassDefFoundError|ClassNotFoundException): (?!Could not initialize class)(?P<class>[\w.$/]+)"##, 0.78, true),
        hint("linkage_error", r##"java\.lang\.(?:NoSuchMethodError|NoSuchFieldError|AbstractMethodError|IncompatibleClassChangeError):\s*['\"]?(?P<class>[\w.$/]+)"##, 0.87, true),
        hint("wrong_mod_environment", r##"Attempted to load class (?P<class>[\w/$]+) for invalid dist (?:DEDICATED_SERVER|CLIENT)|Cannot load class (?P<environment_class>[\w.$/]+) in environment type (?:SERVER|CLIENT)"##, 0.98, true),
        hint("java_too_old", r##"UnsupportedClassVersionError: .*?class file version (?P<required_major>\d+)\.\d+\)?(?:, this version of the Java Runtime only recognizes class file versions up to (?P<runtime_major>\d+))?"##, 0.96, false),
        hint("java_too_new", r##"Unsupported class file major version (?P<runtime_major>\d+)|jdk\.internal\.loader\.ClassLoaders\$AppClassLoader cannot be cast to (?:class )?java\.net\.URLClassLoader"##, 0.88, true),
        hint("metaspace_exhausted", r##"OutOfMemoryError: (?P<detail>Metaspace)\b"##, 0.98, true),
        hint("direct_buffer_exhausted", r##"OutOfMemoryError: (?P<detail>(?:Cannot reserve \d+ bytes of )?direct buffer memory.*)"##, 0.98, true),
        hint("native_thread_exhausted", r##"OutOfMemoryError: (?P<detail>unable to create (?:new )?native thread.*)"##, 0.98, true),
        hint("glfw_context", r##"(?P<detail>GLFW error 6554[23]|Failed to create the GLFW window|WGL: The driver does not appear to support OpenGL|No OpenGL context)"##, 0.91, true),
        hint("opengl_version", r##"Unsupported OpenGL version(?: (?P<present_version>\d+\.\d+))?(?:; OpenGL (?P<range>\d+\.\d+) is required)?|OpenGL (?P<needed>\d+\.\d+) (?:is )?not supported"##, 0.93, true),
        hint("driver_intel", r##"^# [CV]  \[(?P<file>ig\d+icd(?:32|64)\.dll|igxelpicd64\.dll|iris_dri\.so)[+ ]"##, 0.96, true),
        hint("driver_amd", r##"^# [CV]  \[(?P<file>atio6axx\.dll|atioglxx\.dll|amdxc64\.dll|radeonsi_dri\.so)[+ ]"##, 0.96, true),
        hint("driver_nvidia", r##"^# [CV]  \[(?P<file>nvoglv(?:32|64)\.dll|libnvidia-glcore\.so[\w.]*)[+ ]"##, 0.96, true),
        hint("native_jvm_crash", r##"^# [CVJ]\s+\[(?P<file>[^][+\s]+)\+"##, 0.81, true),
        hint("shader_compile", r##"(?:ShaderCompileException|Shader compilation failed|Failed to (?:compile|link) (?:shader|program))(?:(?:.*? in |: )(?P<file>[^/\\\s:]+\.zip)(?=[:\s]|$))?"##, 0.89, true),
        hint("shader_mod_conflict", r##"(?:Iris|Oculus)\b.*(?:incompatible with|cannot run with|cannot be used with).*(?:OptiFine|OptiFabric)"##, 0.95, true),
        hint("corrupt_world_nbt", r##"(?:ReportedNbtException|Invalid tag ID|Tried to read NBT tag with too high complexity|NBT tag .* exceeds).*?(?P<file>saves[/\\].*?(?:level\.dat|\.nbt))\b"##, 0.94, true),
        hint("corrupt_region", r##"(?:Invalid chunk sector offset|Region file header is truncated|Chunk is in the wrong location).*?(?P<file>[^:\r\n]*?r\.-?\d+\.-?\d+\.mca)\b"##, 0.92, true),
        hint("network_timeout", r##"(?:Failed to connect to (?:the )?server|Disconnect(?:ed)?):.*?(?P<class>[\w.]*?(?:SocketTimeoutException|ConnectTimeoutException|ReadTimeoutException))|Failed to connect to (?:the )?server:.*(?:timed out|timeout)"##, 0.9, false),
        hint("network_dns", r##"(?:Failed to connect to (?:the )?server|Disconnect(?:ed)?):.*?(?P<class>[\w.]*UnknownHostException)|Failed to connect to (?:the )?server:.*(?:Unknown host|Name or service not known)"##, 0.91, false),
        hint("network_tls", r##"(?:Failed to connect|Authentication servers are unreachable).*?(?P<class>[\w.]*SSLHandshakeException)|(?:Caused by: )(?P<tls_class>[\w.]*SSLHandshakeException):.*(?:PKIX|certificate)"##, 0.92, false),
        hint("auth_session", r##"Failed to log in:\s*(?P<detail>Invalid session|Failed to verify username|Authentication servers are down)|Disconnect(?:ed)?:.*(?:Invalid session|Failed to verify username)"##, 0.97, false),
        hint("datapack_load", r##"(?:Failed to load datapacks, can't proceed with server load|Failed to load registries due to above errors)(?:.*?for (?P<resource_id>[\w.-]+:[\w./-]+))?"##, 0.94, false),
        hint("recipe_parse", r##"Parsing error loading recipe (?P<resource_id>[\w.-]+:[\w./-]+)|Unknown recipe serializer[: ]+(?P<serializer>[\w.-]+:[\w./-]+)"##, 0.88, true),
        hint("native_lwjgl", r##"UnsatisfiedLinkError: .*?(?:Failed to load.*?native library:\s*|no\s*)(?P<file>(?:lib)?(?:lwjgl|glfw)[\w.-]*)|Failed to locate library:\s*(?P<library>(?:lib)?(?:lwjgl|glfw)[\w.-]*)"##, 0.92, true),
        hint("ticking_block_entity", r##"^\s*Description: Ticking block entity\b"##, 0.9, true),
        hint("ticking_entity", r##"^\s*Description: Ticking entity\b"##, 0.9, true),
        hint("stack_overflow", r##"\bjava\.lang\.StackOverflowError\b"##, 0.94, true),
        hint("watchdog_hang", r##"A single server tick took (?P<detail>[\d.]+\s+seconds)|(?:java\.lang\.Error|Description): Watching Server"##, 0.97, true),
        hint("permission_denied", r##"(?P<class>java\.nio\.file\.AccessDeniedException):\s*(?P<file>.+?)\s*$"##, 0.92, true),
        hint("registry_duplicate", r##"(?:Duplicate registration for |Duplicate key )(?P<resource_id>[\w.-]+:[\w./-]+)(?: from mod (?P<mod_id>[\w.-]+))?"##, 0.89, true),
    ]
});
