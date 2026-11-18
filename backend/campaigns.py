"""Versioned experiment plans, immutable protocols and auditable trial attempts."""
import copy
import csv
import hashlib
import io
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .analyzer import save_json

SPEC = json.loads(Path(__file__).with_name("experiment_protocol.json").read_text(encoding="utf-8"))
PACKAGE = re.compile(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+")
RESOURCE_MODES = tuple(SPEC["resource_orders"][0])
CONDITION_FIELDS = ("account_label", "gemini_mode", "network", "brightness", "volume", "read_aloud")


class CampaignError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def signature(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def comparison_signature(config):
    # Agent/account identity and resource scheduling do not change shared task conditions.
    excluded = {"agent_id", "target_packages", "gemini_mode", "account_label", "scope", "resource_seconds"}
    return signature({key: value for key, value in config.items() if key not in excluded})


def make_trials(phase, window, scope="tasks_and_resources"):
    task_orders = [SPEC["task_orders"][0]] if phase == "pilot" else SPEC["task_orders"]
    resource_orders = [SPEC["resource_orders"][0]] if phase == "pilot" else SPEC["resource_orders"]
    trials = []
    for repetition, order in enumerate(task_orders, 1):
        for workload in order:
            trials.append({"id": f"{phase}-task-r{repetition}-{workload}", "phase": phase,
                           "mode": "trace", "workload": workload, "repetition": repetition,
                           "duration_seconds": SPEC["workloads"][workload]["capture_seconds"],
                           "attempt": 1, "run_ids": [], "superseded": False})
    for repetition, order in enumerate(resource_orders if scope == "tasks_and_resources" else [], 1):
        for mode in order:
            trials.append({"id": f"{phase}-resource-r{repetition}-{mode}", "phase": phase,
                           "mode": mode, "workload": "W0", "repetition": repetition,
                           "duration_seconds": window, "attempt": 1, "run_ids": [], "superseded": False})
    return trials


class Campaigns:
    def __init__(self, root):
        self.root = root / ".campaigns"

    def path(self, campaign_id):
        if not re.fullmatch(r"[0-9a-f]{32}", campaign_id):
            raise CampaignError("campaign_not_found", "Unknown experiment plan")
        return self.root / f"{campaign_id}.json"

    def get(self, campaign_id):
        path = self.path(campaign_id)
        if not path.is_file():
            raise CampaignError("campaign_not_found", "Unknown experiment plan")
        return json.loads(path.read_text(encoding="utf-8"))

    def list(self):
        return sorted((json.loads(path.read_text(encoding="utf-8")) for path in self.root.glob("*.json")),
                      key=lambda item: item["created_at"], reverse=True)

    def save(self, campaign):
        self.root.mkdir(parents=True, exist_ok=True)
        save_json(self.path(campaign["id"]), campaign)
        return campaign

    def create(self, body, parent=None):
        config = copy.deepcopy(body.get("config", {}))
        packages = config.get("target_packages", SPEC["target_packages"])
        if not isinstance(packages, list) or not 1 <= len(packages) <= 6 or any(
                not isinstance(package, str) or not PACKAGE.fullmatch(package) for package in packages):
            raise CampaignError("invalid_packages", "Select one to six installed observation packages")
        config["target_packages"] = list(dict.fromkeys(packages))
        scope = config.get("scope", "tasks_and_resources")
        if scope not in ("tasks_only", "tasks_and_resources"):
            raise CampaignError("invalid_scope", "Choose task trials or tasks with resources")
        agent_id = config.get("agent_id", "gemini")
        if not isinstance(agent_id, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{1,60}", agent_id):
            raise CampaignError("invalid_agent", "Use a stable logical Agent ID, e.g. gemini")
        if agent_id != "gemini" and any(name in SPEC["target_packages"] for name in packages):
            raise CampaignError("agent_alias", "Gemini/Google App package aliases cannot count as a second independent Agent")
        for field in ("device_label", "browser_package", *CONDITION_FIELDS):
            if not isinstance(config.get(field), str) or not config[field].strip() or len(config[field]) > 200:
                raise CampaignError("conditions_required", f"Record the fixed condition: {field}")
            config[field] = config[field].strip()
        if not PACKAGE.fullmatch(config["browser_package"]):
            raise CampaignError("invalid_packages", "Enter a valid browser package")
        window = config.get("resource_seconds", SPEC["resource"]["duration_seconds"])
        if type(window) is not int or window not in (300, 540):
            raise CampaignError("invalid_resource_window", "Choose a 300 or 540 second resource window")
        config.update(resource_seconds=window, prompt=SPEC["prompt"],
                      voice_mode=SPEC["preparation"]["voice_mode"], startup=SPEC["preparation"]["startup"],
                      agent_id=agent_id, scope=scope, automatic_brightness=False, charging=False)
        name = body.get("name", "Gemini / Vivo X80")
        if not isinstance(name, str) or not name.strip() or len(name) > 160:
            raise CampaignError("invalid_name", "Enter a plan name of at most 160 characters")
        definition = copy.deepcopy(SPEC)
        if agent_id != "gemini":
            for workload in definition["workloads"].values():
                workload["instructions"] = {locale: text.replace("Gemini", agent_id)
                                             for locale, text in workload["instructions"].items()}
            definition["checklist"] = {locale: [text.replace("Gemini", agent_id) for text in items]
                                       for locale, items in definition["checklist"].items()}
        campaign = {"id": uuid.uuid4().hex, "name": name.strip(), "created_at": timestamp(),
                    "state": "draft", "protocol_version": SPEC["version"], "protocol": definition,
                    "config": config, "config_signature": signature(config), "parent_id": parent,
                    "comparison_signature": comparison_signature(config), "comparison_signature_version": 2,
                    "trials": make_trials("pilot", window, scope), "audit": []}
        return self.save(campaign)

    def revise(self, campaign_id, body):
        previous = self.get(campaign_id)
        return self.create({"name": body.get("name", previous["name"] + " / revision"),
                            "config": body.get("config", previous["config"])}, campaign_id)

    def trial(self, campaign, trial_id):
        match = next((item for item in campaign["trials"] if item["id"] == trial_id), None)
        if match is None:
            raise CampaignError("trial_not_found", "Unknown trial")
        return match

    def prepare(self, campaign_id, trial_id, records):
        campaign = self.get(campaign_id)
        trial = self.trial(campaign, trial_id)
        pending = next((item for item in campaign["trials"] if not item["run_ids"] and not item["superseded"]), None)
        if pending is None or pending["id"] != trial_id or trial["run_ids"] or trial["superseded"]:
            raise CampaignError("trial_order", "Start the next pending trial, or create an explicit retry")
        if trial["phase"] == "formal" and campaign["state"] != "frozen":
            raise CampaignError("pilot_required", "Complete and review the pilot before formal trials")
        previous = [item for item in campaign["trials"][:campaign["trials"].index(trial)]
                    if item["run_ids"] and not item["superseded"]]
        if previous and records:
            latest = records.get(previous[-1]["run_ids"][-1], {})
            if latest.get("status") == "failed":
                raise CampaignError("retry_reason", "Review the failed capture and create a documented retry before proceeding")
            if latest.get("outcome") not in ("success", "failure", "timeout", "unexpected_activity"):
                raise CampaignError("outcome_required", "Save the previous trial's actual outcome before proceeding")
        config = campaign["config"]
        return {"campaign_id": campaign_id, "trial_id": trial_id, "phase": trial["phase"],
                "attempt": trial["attempt"], "protocol_version": campaign["protocol_version"],
                "protocol_snapshot": campaign["protocol"], "condition_profile": config,
                "condition_signature": campaign["config_signature"], "agent_id": config["agent_id"],
                "target_packages": config["target_packages"], "target_package": config["target_packages"][0],
                "device_label": config["device_label"], "conditions": campaign.get("comparison_signature", campaign["config_signature"]),
                "scope_confirmed": campaign.get("scope_confirmed", False),
                "mode": trial["mode"], "workload": trial["workload"], "repetition": trial["repetition"],
                "duration_seconds": trial["duration_seconds"], "sample_interval_seconds": 15,
                "settle_seconds": 30, "temperature_baseline_c": campaign.get("temperature_baseline_c")}

    def attach(self, campaign_id, trial_id, run_id):
        campaign = self.get(campaign_id)
        self.trial(campaign, trial_id)["run_ids"].append(run_id)
        campaign["audit"].append({"at": timestamp(), "event": "run_started", "trial_id": trial_id, "run_id": run_id})
        self.save(campaign)

    def retry(self, campaign_id, trial_id, reason, records):
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 1000:
            raise CampaignError("retry_reason", "Record why this trial needs an infrastructure or protocol retry")
        campaign = self.get(campaign_id)
        trial = self.trial(campaign, trial_id)
        if trial["superseded"] or not trial["run_ids"]:
            raise CampaignError("trial_order", "Retry a completed attempt")
        resource = trial["mode"] in RESOURCE_MODES
        group = [item for item in campaign["trials"] if not item["superseded"] and
                 (item["id"] == trial_id or resource and item["mode"] in RESOURCE_MODES and
                  item["phase"] == trial["phase"] and item["repetition"] == trial["repetition"])]
        if any(records.get(run_id, {}).get("status") not in ("complete", "failed")
               for item in group for run_id in item["run_ids"]):
            raise CampaignError("experiment_active", "Finish the active capture before retrying")
        replacements = []
        for item in group:
            item["superseded"] = True
            replacement = copy.deepcopy(item)
            replacement.update(id=item["id"] + "-retry", attempt=item["attempt"] + 1, run_ids=[],
                               superseded=False, replaces_trial_id=item["id"], retry_reason=reason.strip())
            replacements.append(replacement)
        # Put replacements before the next unstarted block, preserving arm order.
        position = next((index for index, item in enumerate(campaign["trials"])
                         if not item["run_ids"] and not item["superseded"]), len(campaign["trials"]))
        campaign["trials"][position:position] = replacements
        campaign["audit"].append({"at": timestamp(), "event": "retry", "trial_id": trial_id, "reason": reason.strip()})
        return self.save(campaign)

    def freeze(self, campaign_id, body, records, quality, root):
        campaign = self.get(campaign_id)
        if campaign["state"] == "frozen":
            return campaign
        if body.get("scope_confirmed") is not True or body.get("pilot_reviewed") is not True:
            raise CampaignError("scope_confirmation", "Review the pilot and explicitly confirm the observation package set")
        pilots = [item for item in campaign["trials"] if item["phase"] == "pilot" and not item["superseded"]]
        for trial in pilots:
            if len(trial["run_ids"]) != 1:
                raise CampaignError("pilot_required", "Every pilot slot in this saved plan must be completed and reviewed")
            run_id = trial["run_ids"][0]
            run = records[run_id]
            result = quality(run_id)
            if run.get("outcome") != "success" or not result.get("protocol_valid", result["valid"]):
                raise CampaignError("pilot_required", "Resolve pilot protocol or capture problems before freezing")
            if trial["mode"] in RESOURCE_MODES:
                summary = json.loads((root / run_id / "resources_summary.json").read_text(encoding="utf-8"))
                if any(summary["metrics"][key]["median"] is None for key in ("agent_cpu_one_core_percent", "agent_pss_kib")):
                    raise CampaignError("resource_metrics_required", "Resolve Agent CPU/PSS availability before formal resources")
                if summary["battery"]["estimated_energy_mwh"] is None and body.get("energy_unresolved_ack") is not True:
                    raise CampaignError("energy_review", "Review energy resolution; extend to 540 seconds or acknowledge the limitation")
        # Task-only campaigns deliberately do not reopen the completed resource phase.
        first_resource = next((item for item in pilots if item["mode"] == "resource_agent"), None)
        temperature = None
        if first_resource:
            raw = json.loads((root / first_resource["run_ids"][0] / "resources.json").read_text(encoding="utf-8"))
            temperature = raw["samples"][0]["battery"].get("temperature_tenths_c")
        identities = [records[item["run_ids"][0]].get("identity_snapshot") for item in pilots]
        if any(identity is None for identity in identities) or any(identity != identities[0] for identity in identities):
            raise CampaignError("identity_changed", "Device or application versions changed during the pilot; start a revision")
        # Upgrade only the derived key of a reviewed draft; pilot records and config hashes stay intact.
        updated_signature = comparison_signature(campaign["config"])
        if campaign.get("comparison_signature") != updated_signature:
            campaign["audit"].append({"at": timestamp(), "event": "comparison_signature_updated",
                                      "previous": campaign.get("comparison_signature"), "current": updated_signature,
                                      "version": 2})
        campaign.update(comparison_signature=updated_signature, comparison_signature_version=2)
        campaign.update(state="frozen", frozen_at=timestamp(), scope_confirmed=True,
                        identity_snapshot=identities[0], temperature_baseline_c=temperature / 10 if temperature is not None else None,
                        energy_unresolved_ack=body.get("energy_unresolved_ack", False))
        campaign["trials"].extend(make_trials("formal", campaign["config"]["resource_seconds"],
                                            campaign["config"].get("scope", "tasks_and_resources")))
        campaign["audit"].append({"at": timestamp(), "event": "protocol_frozen"})
        return self.save(campaign)

    def export(self, campaign_id, records, quality):
        campaign = self.get(campaign_id)
        return {"campaign": campaign, "records": [
            {"trial": trial, "runs": [{"metadata": records[run_id], "quality": quality(run_id),
                                        "source": f"{run_id}/metadata.json"}
                                       for run_id in trial["run_ids"] if run_id in records]}
            for trial in campaign["trials"]], "instructions": campaign["protocol"]["checklist"]}

    def guide(self, campaign_id, locale="en"):
        """Generate the operator handout from the exact saved protocol snapshot."""
        campaign = self.get(campaign_id)
        definition = campaign["protocol"]
        chinese = locale == "zh-CN"
        lines = [f"# {campaign['name']}", "", f"Protocol {campaign['protocol_version']} · {campaign['state']}", "",
                 "预试计划；冻结后才可运行正式试次。" if chinese else "Pilot plan; formal trials require a reviewed, frozen protocol.",
                 "", "## 固定条件" if chinese else "## Fixed conditions", ""]
        lines.extend(f"- `{key}`: {json.dumps(value, ensure_ascii=False)}" for key, value in campaign["config"].items())
        lines.extend(["", "## 操作检查" if chinese else "## Operating checklist", ""])
        lines.extend(f"{index}. {instruction}" for index, instruction in enumerate(definition["checklist"][locale], 1))
        for name, workload in definition["workloads"].items():
            lines.extend(["", f"## {name}", "", workload["instructions"][locale], "", f"`{definition['prompt']}`", "",
                          " → ".join(workload["sequence"]), "", ", ".join(f"`{field}`" for field in workload["required_fields"])])
        lines.extend(["", "## 试次清单" if chinese else "## Trial checklist", "",
                      "| Trial | Phase | Mode | Workload | Repetition | Attempt | Seconds |",
                      "|---|---|---|---|---|---|---|"])
        for trial in campaign["trials"]:
            if not trial["superseded"]:
                lines.append(f"| {trial['id']} | {trial['phase']} | {trial['mode']} | {trial['workload']} | {trial['repetition']} | {trial['attempt']} | {trial['duration_seconds']} |")
        lines.extend(["", "## 填写示例（不是实际结果）" if chinese else "## Entry examples (not observed results)", "",
                      "W1: `browser_package=com.android.chrome`; `actual_url=https://www.wikipedia.org/`; `confirmation_status=none`.",
                      "仅在亲眼确认后勾选网页显示；未看到或超时必须如实填写。不可补造时间标记。" if chinese else
                      "Confirm page visibility only after seeing it. Record failure or timeout honestly. Never invent missing timestamps.",
                      "W2: `recognized_text_available=false` when recognition text is not visible; retain the actual response.",
                      "仅任务计划不重复已完成的资源阶段。" if chinese and campaign["config"].get("scope") == "tasks_only" else
                      "Task-only plans do not repeat the completed resource phase." if campaign["config"].get("scope") == "tasks_only" else
                      "Resources: 30 s preparation, 15 s sampling; A/B/C share one fixed window and observer configuration."])
        return "\n".join(lines).encode("utf-8")

    def csv(self, campaign_id, records, quality):
        bundle = self.export(campaign_id, records, quality)
        buffer = io.StringIO()
        fields = ["trial_id", "phase", "mode", "workload", "repetition", "attempt", "superseded",
                  "run_id", "capture_status", "outcome", "eligible", "issues"]
        writer = csv.DictWriter(buffer, fields)
        writer.writeheader()
        for record in bundle["records"]:
            trial = record["trial"]
            for run in record["runs"] or [None]:
                writer.writerow({**{key: trial[key] for key in fields if key in trial}, "trial_id": trial["id"],
                                 "run_id": run["metadata"]["id"] if run else "",
                                 "capture_status": run["metadata"]["status"] if run else "pending",
                                 "outcome": run["metadata"].get("outcome") if run else "",
                                 "eligible": run["quality"]["valid"] if run else False,
                                 "issues": json.dumps(run["quality"]["issues"], ensure_ascii=False) if run else "[]"})
        return buffer.getvalue().encode("utf-8-sig")
