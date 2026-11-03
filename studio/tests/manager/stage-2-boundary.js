/*
 * Owner-run staging boundary smoke check.
 * Open the authenticated staging site, open the browser console, paste this
 * entire file, and run it. Do not paste the session, cookies, or output from
 * other browser panels into chat. This check never reads response bodies.
 * Run only before the initial import: the sole POST has deliberately invalid
 * input and a foreign origin. Browser CORS can hide the server's response.
 */
(async () => {
  const expectedOrigin = "https://project-manager.ezth.workers.dev";
  if (location.origin !== expectedOrigin) {
    console.info("Boundary check: open the canonical staging site first.");
    return;
  }
  const results = [];
  async function probe(label, resource, options = {}) {
    try {
      const response = await fetch(`${expectedOrigin}${resource}`, {
        cache: "no-store",
        redirect: "manual",
        ...options,
      });
      results.push({
        check: label,
        status: response.status,
        cache: response.headers.get("cache-control"),
      });
      return response.status;
    } catch {
      results.push({ check: label, status: "network error", cache: null });
      return null;
    }
  }

  await probe("signed-out backup status", "/api/manager-backup", {
    credentials: "omit",
  });
  const ownerStatus = await probe(
    "owner backup status",
    "/api/manager-backup",
    {
      credentials: "same-origin",
    },
  );
  if (ownerStatus !== 200) {
    console.table(results);
    console.info("Owner session unavailable; sign in before retrying.");
    return;
  }
  await probe(
    "backup with forged actor and target headers",
    "/api/manager-backup",
    {
      credentials: "same-origin",
      headers: {
        "x-manager-actor": "0",
        "x-manager-target": "https://example.invalid",
      },
    },
  );
  await probe(
    "owner project read before import",
    "/api/manager/projects.list",
    {
      credentials: "same-origin",
    },
  );
  await probe(
    "project read with forged actor and target headers",
    "/api/manager/projects.list",
    {
      credentials: "same-origin",
      headers: {
        "x-manager-actor": "0",
        "x-manager-target": "https://example.invalid",
      },
    },
  );

  const crossOrigin = await new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("sandbox", "allow-scripts");
    let timer;
    const finish = (value) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      frame.remove();
      resolve(value);
    };
    const receive = (event) => {
      if (
        event.source === frame.contentWindow &&
        event.data?.type === "boundary-cross-origin"
      ) {
        finish(event.data.status);
      }
    };
    window.addEventListener("message", receive);
    timer = setTimeout(() => finish("blocked or timed out"), 10000);
    // The opaque-origin frame cannot access this page, its cookies, or results.
    // This is a CORS-simple request with invalid tRPC input, not a valid mutation.
    frame.srcdoc = `<script>fetch(${JSON.stringify(`${expectedOrigin}/api/manager/projects.create`)},{method:"POST",credentials:"include",headers:{"content-type":"text/plain"},body:"invalid"}).then(r=>parent.postMessage({type:"boundary-cross-origin",status:r.status},"*")).catch(()=>parent.postMessage({type:"boundary-cross-origin",status:"blocked or unreadable"},"*"));</script>`;
    document.body.appendChild(frame);
  });
  results.push({
    check: "cross-origin invalid mutation",
    status: crossOrigin,
    cache: null,
  });
  console.table(results);
  console.info(
    "A 200 owner backup status indicates the private binding answered. " +
      "A pre-import project error does not by itself prove why it failed. " +
      "A blocked or unreadable cross-origin response is inconclusive about the server's status. " +
      "Header probes do not replace a separate non-owner identity test.",
  );
})();
