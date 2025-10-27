const TOKEN: TokenData = loadFile("./token.json") as TokenData;
const SECRETS: ClientSecrets = loadFile("./secrets.json") as ClientSecrets;
const STORE: [number, number] = [42.33945423204923, -71.13583463268861]; // Marathon Sports Brookline

interface MatchedActivityDetail {
  id: number;
  activity: Activity | null;
  startIndex: number;
  endIndex: number;
  distance: number;
  flagged?: true;
}
async function main() {
  makeOutputFolders();
  // Once run initially, can be commented out to use saved data and avoid API reqs
  await savePotentialRunClubRuns();

  const activities: Activity[] = loadFile("./data/possible_run_club_runs.json") as Activity[];

  // Once run initially, can be commented out to use saved data and avoid API reqs
  await saveRunStreamData(activities);

  const activityStreams = await loadActivityStreams();

  /**
   * Iterate over all activity streams to match runs to the run club.
   *
   * If this wasn't just a simple script, this should be factored into it's own
   * function
   */
  const runClubActivities: MatchedActivityDetail[] = [];
  const dates: Record<string, boolean> = {};
  for (const [id, s] of Object.entries(activityStreams)) {
    let streams: ActivityStream[] = [];
    if (isStreamArr(s) === true) {
      streams = s as ActivityStream[];
    }
    const a = getActivityById(Number(id), activities);
    // Find the first latlng stream that occurs within 1K of the store, then
    // choose the closest latln to the store within 10 minutes after that
    if (a !== null && streams.length) {
      const activity = a as Activity;
      const start = findStartPoint(streams);
      const end = findEndPoint(streams);
      const simpleDate = new Date(activity.start_date).toLocaleDateString();
      if (start.index === -1 || end.index === -1) {
        console.log(`Failed to find start or end for activity ${id}`);
      } else if (dates[simpleDate]) {
        console.log(`Duplicate activities found for ${simpleDate}`);
      } else {
        dates[simpleDate] = true;
        const { distance } = remapStreams(streams);
        const details: MatchedActivityDetail = {
          id: Number(id),
          activity: null,
          startIndex: start.index,
          endIndex: end.index,
          distance: distance.data[end.index] - distance.data[start.index],
        };
        if (details.distance < 2000) details.flagged = true;
        runClubActivities.push(details);
      }
    } else if (!(streams instanceof Array)) {
      console.log(`Error with activity ${id}: ${(s as StravaError).message}`);
    } else {
      console.log(`Missing activity details for ${id}`);
    }
  }

  console.log(`${runClubActivities.length} matched activities of ${activities.length} potential`);

  /**
   * Compute some stats to output
   */
  let sum = 0;

  /**
   * Limit summed distance to 10K per run
   */
  for (const details of runClubActivities) {
    sum += details.distance < 10000 ? details.distance : 10000;
  }
  console.log(sum);

  /**
   * Save summary data for the runs to a TSV file
   */
  Deno.writeTextFileSync(
    "./data/run_club_runs.tsv",
    toTsv(runClubActivities, activities),
  );
}
function makeOutputFolders() {
  try {
    Deno.mkdirSync("./data/activities", { recursive: true });
  } catch (e) {
    console.log(e);
  }
}
function toTsv(data: MatchedActivityDetail[], activities: Activity[]): string {
  //DateActivity Start TimeActivity End TimeDistanceRun Club Start TimeRun Club DistanceFlagged
  const results: string[] = [];
  for (const details of data) {
    const activity = getActivityById(details.id, activities);
    if (!activity) continue;
    const date = new Date(activity.start_date);
    const row = [
      details.id,
      `https://www.strava.com/activities/${details.id}`,
      new Date(activity.start_date).toLocaleDateString(),
      activity.elapsed_time,
      details.distance < 10000 ? details.distance.toFixed(0) : 10000,
      details.flagged ? "true" : "",
    ];
    results.push(row.join("\t"));
  }
  return results.join("\n");
}

function getActivityById(id: number, activities: Activity[]): Activity | null {
  for (const activity of activities) {
    if (activity.id === id) return activity;
  }
  return null;
}

function findEndPoint(
  streams: ActivityStream[],
): { index: number; distFromStore: number; timestamp: number } {
  const { latlng, time, distance } = remapStreams(streams);
  const end = {
    index: -1,
    distFromStore: Infinity,
    timestamp: -1,
  };
  for (let i = latlng.data.length - 1; i > 0; i--) {
    const [lat, lng] = latlng.data[i];
    const timestamp = time.data[i];
    const distFromStore = haversineDistanceKm(STORE, [lat, lng]);
    if (distFromStore < .4) {
      if (end.index === -1) {
        end.index = i;
        end.distFromStore = distFromStore;
        end.timestamp = timestamp;
      } else if (distFromStore < end.distFromStore && timestamp - end.timestamp >= 600) {
        end.index = i;
        end.distFromStore = distFromStore;
        end.timestamp = timestamp;
      }
    }
  }
  return end;
}

function findStartPoint(
  streams: ActivityStream[],
): { index: number; distFromStore: number; timestamp: number } {
  const { latlng, time, distance } = remapStreams(streams);
  const start = {
    index: -1,
    distFromStore: Infinity,
    timestamp: -1,
  };
  for (let i = 0; i < latlng.data.length; i++) {
    const [lat, lng] = latlng.data[i];
    const timestamp = time.data[i];
    const distFromStore = haversineDistanceKm(STORE, [lat, lng]);
    if (distFromStore < 1) {
      if (start.index === -1) {
        start.index = i;
        start.distFromStore = distFromStore;
        start.timestamp = timestamp;
      } else if (distFromStore < start.distFromStore && timestamp - start.timestamp <= 600) {
        start.index = i;
        start.distFromStore = distFromStore;
        start.timestamp = timestamp;
      }
    }
  }
  return start;
}

function remapStreams(streams: ActivityStream[]): Record<string, ActivityStream> {
  const out: Record<string, ActivityStream> = {};
  // deno was giving type errors with for of loop
  for (let i = 0; i < streams.length; i++) {
    const stream = streams[i];
    out[stream.type] = stream;
  }
  return out;
}

/**
 * Activity stream is an array of streams that have data associated with an
 *  activity
 */
interface ActivityStream {
  type: "time" | "latlng" | "distance";
  series_type: "distance";
  original_size: number;
  resolution: "high";
  data: any[];
}
interface TimeStream extends ActivityStream {
  type: "time";
  data: number[];
}
interface LatLngStream extends ActivityStream {
  type: "latlng";
  data: [number, number][];
}
interface DistanceStream extends ActivityStream {
  type: "distance";
  data: number[];
}
interface StravaError {
  message: string;
  errors: { resource: string; field: string; code: string }[];
}
async function loadActivityStreams(): Promise<Record<string, ActivityStream[] | StravaError>> {
  const files = Deno.readDirSync("./data/activities");
  const activities: Record<string, ActivityStream[] | StravaError> = {};
  for (const file of files) {
    const [name, id] = file.name.match(/(^\d+).json/) || [];
    if (!id) continue;
    const content = Deno.readTextFileSync(`./data/activities/${file.name}`);
    activities[id] = JSON.parse(content) as ActivityStream[] | StravaError; 
  }
  return activities;
}

async function saveRunStreamData(activities: Activity[]) {
  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    const { access_token } = await getToken();
    const url =
      `https://www.strava.com/api/v3/activities/${activity.id}/streams?keys_by_type=true&keys=time,latlng`;
    const res = await fetch(
      url,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    console.log(`Downloaded activity stream data ${i} of ${activities.length}`);
    Deno.writeTextFileSync(
      `./data/activities/${activity.id}.json`,
      JSON.stringify(await res.json()),
    );
  }
}

/**
 * Iterates over all activitie summary details and saves details for any that could be
 * a run club run
 */
async function savePotentialRunClubRuns() {
  const possibleMatches: Activity[] = [];
  // getAtivities makes API calls
  for await (const activity of getActivities()) {
    if (couldBeRunClubRun(activity)) {
      possibleMatches.push(activity);
    }
  }
  Deno.writeTextFileSync(
    "./data/possible_run_club_runs.json",
    JSON.stringify(possibleMatches, null, 2),
  );
}

function couldBeRunClubRun(activity: Activity): boolean {
  const startTime = new Date(activity.start_date);
  const endTime = new Date(startTime.getTime() + activity.elapsed_time * 1000);
  if (startTime.getDay() != 4) return false; // not a thursday

  const distanceFromStore = haversineDistanceKm(STORE, activity.start_latlng);
  if (distanceFromStore > 20) return false; // 20K

  // Ensure activity started before run club time, and finished after run club time
  const runClubTime = new Date(startTime.toDateString() + " 18:50:00");
  if (startTime > runClubTime || endTime < runClubTime) {
    return false;
  }

  /** Exclude all activities before this date as covid shut down in person runs */
  if (
    startTime.getTime() > new Date("2020-02-01").getTime() &&
    startTime.getTime() < new Date("2021-07-28").getTime()
  ) {
    return false;
  }
  return true;
}

/**
 * There are many more properties available, see:
 * https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivitie://developers.strava.com/docs/reference/#api-models-DetailedActivity
 */
interface Activity {
  elapsed_time: number;
  id: number;
  start_date: string;
  start_latlng: [number, number];
}
/**
 * https://developers.strava.com/docs/
 * Requests that return multiple items will be paginated to 30 items by default. The page
 * parameter can be used to specify further pages or offsets. The per_page may also be used for
 * custom page sizes up to 200. Note that in certain cases, the number of items returned in the
 * response may be lower than the requested page size, even when that page is not the last. If you
 * need to fully go through the full set of results, prefer iterating until an empty page is
 * returned.
 */
async function* getActivities(page = 1, lastPage = Infinity): AsyncGenerator<Activity> {
  while (true && page <= lastPage) {
    const { access_token } = await getToken();
    const before = 0;
    const after = 0;
    const per_page = 200;
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${per_page}&after=${after}`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    const activities: Activity[] = await res.json();
    console.log(`Loaded page ${page} of activity summaries...`);
    for (const activity of activities) yield activity;
    if (activities.length === 0) break;
    page++;
  }
  return;
}

/**
 * Get token, refresh if expired. Refresh will write new token to token.json
 */
async function getToken(): Promise<TokenData> {
  if (TOKEN.expires_at < Date.now() / 1000) {
    const newToken = await refreshToken();
    return TOKEN;
  }
  return TOKEN;
}

interface TokenData {
  token_type: string;
  access_token: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
}

interface ClientSecrets {
  client_id: string;
  client_secret: string;
}
async function refreshToken(): Promise<TokenData> {
  const { client_id, client_secret } = SECRETS;
  const { refresh_token } = TOKEN;

  const url = "https://www.strava.com/oauth/token";
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: client_id,
      client_secret: client_secret,
      grant_type: "refresh_token",
      refresh_token: refresh_token,
    }),
  });
  const newToken = await response.json();
  if (newToken.access_token) {
    Deno.writeTextFileSync("./token.json", JSON.stringify(newToken, null, 2));
  }
  Object.assign(TOKEN, newToken);
  return TOKEN;
}

function loadFile(path: string): unknown {
  const file = Deno.readTextFileSync(path);
  return JSON.parse(file);
}

/**
 * Haversine distance formula for calculating shortest distance between two lat/ln pairs.
 * https://github.com/thealmarques/haversine-distance-typescript/blob/master/index.ts
 *
 * returns in km
 */
function haversineDistanceKm(pointA: [number, number], pointB: [number, number]): number {
  var radius = 6371; // km

  //convert lat and lng to radians
  const deltaLatitude = (pointB[0] - pointA[0]) * Math.PI / 180;
  const deltaLongitude = (pointB[1] - pointA[1]) * Math.PI / 180;

  const halfChordLength = Math.cos(
        pointA[0] * Math.PI / 180,
      ) *
      Math.cos(pointB[0] * Math.PI / 180) *
      Math.sin(deltaLongitude / 2) * Math.sin(deltaLongitude / 2) +
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2);

  const angularDistance = 2 *
    Math.atan2(Math.sqrt(halfChordLength), Math.sqrt(1 - halfChordLength));

  return radius * angularDistance;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStreamArr(stream: ActivityStream[] | StravaError): stream is ActivityStream[] {
  return true;
}

main();
