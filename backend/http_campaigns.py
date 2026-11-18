"""Versioned plan routes; mutations remain serialized by the run coordinator."""


def route_campaign(handler, method, parts, runs):
    if parts == ["api", "campaigns"]:
        with runs.lock:
            if method == "GET":
                handler.respond(200, runs.campaigns.list())
                return True
            if method == "POST":
                handler.respond(201, runs.campaigns.create(handler.body()))
                return True
    if parts[:2] != ["api", "campaigns"] or len(parts) < 3:
        return False
    campaign_id, action = parts[2], parts[3:]
    with runs.lock:
        if method == "GET" and not action:
            handler.respond(200, runs.campaigns.get(campaign_id))
        elif method == "GET" and action == ["export.json"]:
            handler.respond(200, runs.campaigns.export(campaign_id, runs.runs, runs.quality), filename="experiment-plan.json")
        elif method == "GET" and action == ["export.csv"]:
            handler.respond(200, runs.campaigns.csv(campaign_id, runs.runs, runs.quality), "text/csv", "trial-records.csv")
        elif method == "GET" and action in (["guide.en.md"], ["guide.zh-CN.md"]):
            locale = "zh-CN" if action[0] == "guide.zh-CN.md" else "en"
            handler.respond(200, runs.campaigns.guide(campaign_id, locale), "text/markdown; charset=utf-8", action[0])
        elif method == "POST" and action == ["freeze"]:
            handler.respond(200, runs.campaigns.freeze(campaign_id, handler.body(), runs.runs, runs.quality, runs.root))
        elif method == "POST" and action == ["revise"]:
            handler.respond(201, runs.campaigns.revise(campaign_id, handler.body()))
        elif method == "POST" and action == ["retry"]:
            body = handler.body()
            campaign = runs.campaigns.retry(campaign_id, body.get("trial_id"), body.get("reason"), runs.runs)
            for trial in campaign["trials"]:
                if trial.get("replaces_trial_id"):
                    original = runs.campaigns.trial(campaign, trial["replaces_trial_id"])
                    for run_id in original["run_ids"]:
                        runs.update(run_id, superseded_by_trial=trial["id"])
            handler.respond(200, campaign)
        else:
            return False
    return True
