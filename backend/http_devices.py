"""Device discovery and capability probes without experimental side effects."""
from . import collector, resources
from .contracts import APIError, PACKAGE, TERMINAL


def route_device(handler, method, parts, runs):
    if method == "GET" and parts == ["api", "devices"]:
        handler.respond(200, collector.devices())
        return True
    if parts[:2] != ["api", "devices"] or method != "POST":
        return False
    if parts[2:] not in (["packages"], ["package-details"], ["resource-capabilities"]):
        return False
    body = handler.body()
    serial, package = body.get("serial"), body.get("package")
    if not isinstance(serial, str) or serial not in collector.devices():
        raise APIError(400, "Selected ADB device is unavailable.")
    if parts[2:] == ["packages"]:
        handler.respond(200, sorted(collector.packages(serial)))
        return True
    if not isinstance(package, str) or not PACKAGE.fullmatch(package):
        raise APIError(400, "Enter a valid Agent package." if parts[2:] == ["resource-capabilities"] else "Enter a valid package name.")
    if parts[2:] == ["package-details"]:
        try:
            handler.respond(200, collector.package_details(serial, package))
        except ValueError as exc:
            raise APIError(400, str(exc)) from exc
        return True
    targets = body.get("target_packages", [package])
    if not isinstance(targets, list) or not 1 <= len(targets) <= 6 or any(not isinstance(name, str) or not PACKAGE.fullmatch(name) for name in targets):
        raise APIError(400, "Select observation packages", "invalid_packages")
    with runs.lock:
        if any(run["status"] not in TERMINAL for run in runs.runs.values()):
            raise APIError(409, "Run capability checks only when no experiment is active.")
        handler.respond(200, resources.capabilities(serial, targets if "target_packages" in body else package, observer=resources.CURRENT_OBSERVER))
    return True
