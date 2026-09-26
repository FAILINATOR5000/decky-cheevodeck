from pathlib import Path

import decky
import subprocess_util


ARM64_DIR = "aarch64"

HASHER = "RAHasher"
CHDMAN = "chdman"

_BANNERS = {HASHER: "RAHasher", CHDMAN: "chdman"}

_PROBE_TIMEOUT_SECONDS = 10

_ARM64_LOADERS = (
    Path("/lib/ld-linux-aarch64.so.1"),
    Path("/usr/lib/ld-linux-aarch64.so.1"),
    Path("/lib64/ld-linux-aarch64.so.1"),
)

_KERNEL_ARCH = Path("/proc/sys/kernel/arch")

_LOADER_FAILURE = "error while loading shared libraries"


def tool_fault(code: int, err: str):
    err = err or ""
    if subprocess_util.EXEC_MARKER in err:
        return err.strip().splitlines()[0]
    if _LOADER_FAILURE in err:
        return err.strip().splitlines()[0]
    if code in (126, 127):
        return f"exit {code}"
    return None


def probe(path: Path):
    if not path.exists():
        return "missing"
    code, out, err = subprocess_util.run_command([str(path)], timeout=_PROBE_TIMEOUT_SECONDS)
    if subprocess_util.TIMEOUT_MARKER in err:
        return "timed out"
    fault = tool_fault(code, err)
    if fault is not None:
        return fault
    if _BANNERS.get(path.name, path.name) not in (out + err):
        return f"exit {code} with no usage text"
    return None


def host_is_arm64() -> bool:
    for loader in _ARM64_LOADERS:
        if loader.exists():
            return True
    try:
        return _KERNEL_ARCH.read_text(encoding="ascii").strip() == "aarch64"
    except OSError:
        return False


def choose_dir(bin_dir: Path) -> Path:
    if not host_is_arm64():
        return bin_dir
    arm_dir = bin_dir / ARM64_DIR
    for tool in (HASHER, CHDMAN):
        try:
            (arm_dir / tool).chmod(0o755)
        except OSError:
            pass
    reason = probe(arm_dir / HASHER)
    if reason is None:
        decky.logger.info("cheevocheck: ARM64 host, using the tools in %s", arm_dir)
        return arm_dir
    decky.logger.warning(
        "cheevocheck: ARM64 host but the ARM64 RAHasher won't run (%s), falling back to %s",
        reason, bin_dir,
    )
    return bin_dir
