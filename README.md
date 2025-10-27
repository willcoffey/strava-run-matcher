# A Basic script for looking at Strava activities

My run club gives you a reward when you reach 1000 miles running with them. I
haven't been in the habit of signing in, but recorded all my runs on Strava. 
Pulling and analyzing the data from Strava is a simple well defined task to get
familiar with their API.

Potential match summary data is saved to `data/possible_run_club_runs.json`

Activity streams are saved to `data/activities/{activity_id}.json`

Summaries of matched runs are saved to `data/run_club_runs.tsv`

# Hello Strava API
Strava uses OAuth, and there is a bit of setup to do before wrting the script.

## Setting up a Strava App
First step is creating a strava "app" on [their site.][1].
For settings I input
 - Category: DataImporter
 - Website: N/A
 - Application Description: Script to find my run club runs.
 - Authorization Callback Domain: localhost

In addition, you need to upload an icon for the app. I used a generic SVG from 
SVGRepo and converted it to JPG using ImageMagick. 

[1]: https://www.strava.com/settings/api

## Getting an Access Token
On the application web page, it does provide an access token but it only has 
`read` scope which isn't very useful. I wrote a script to get a token with 
`read_all` scope manually. First, ensure that `secrets.json` exists in the
following format:
```json

{
  "client_id": 555555,
  "client_secret": "..."
}
```
The id and secret are on the strava app page.

Then run the following script to get an authorization code 
`deno run --allow-all get_strava_token.ts`
Copy the url it prints and open it in a browser. Authorize the app and it will
redirect to localhost, which will fail to load but the url has the needed auth
code. Copy the code value, the letters and numbers after the `&code=` and paste
it back into the terminal. The script then gets the access and refresh token and
saves it to `token.json`.

# Processing Activity Data
Analyzing the runs is a two stage process. First, a summary of all activities is
loaded and filtered for possible matches. Next the potential matches get full
details loaded and further checked to see if they match to a run club match.

## Filtering Activity List
All activities are iterated over and filtered if they are a possible match. There
are many properties on the Activity object, but the only ones used are
```typescript
interface Activity {
  elapsed_time: number;
  id: number;
  start_date: string;
  start_latlng: [number, number];
}
```

The activities get filtered as potential matches if they:
 - Occur on a Thursday
 - Occur within 10 miles of the running store
 - Are ongoing at 6:50PM
 - Occur after 2021-07-28 or before 2020-02-01 because of Covid shutdown. I was
 unsure when covid shut the club down, so I arbitrarily picked a conservative
date.

## Analyzing individual activities
I was pleasantly surprised by the format that is provided by by the strava API.
I was assuming I was going to have to parse gpx files and calculate distances
myself but that's not the case.

The strava `streams` endpoint provides an array of stream data objects that
contain data about different properties such as time, lat/lng, and distance.
More specifically, the api response is an array of
```typescript
interface ActivityStream {
  type: "time" | "latlng" | "distance";
  series_type: "distance";
  original_size: number;
  resolution: "high";
  data: any[];
}
```
where the `data` arrays are all parallel. There are more stream types than 
listed above, but it's all that is needed for now.

---

Each `ActivityStream` response is analyzed to see if it is a run club run.

### Start Point
Iterate over the `latln` to find the first point that is within 600 meters of 
the store, then find the closest point to the store that occurs within the next
10 minutes.

### End Point
The end point is found similarly to the start point, starting from the last point
int the stream and iterating in the opposite direction.

### Distance
The distance stream is used to get the distance between start and end point so 
that only the distance run during run club is counted and not the run to the 
store or back home. If the distance is less than 2K the activity is flagged, in
my case these were all runs where I hadn't started the activity until part way
through the run. These flagged activities can be manually reviewed.

# Outputting
Once all the activities have been filtered, some basic details get saved to 
`tsv` which can then be pasted into a spreadsheet for further review. Just a row
of
| Activity ID | Strava Link | Date | Activity Duration | Run Club Distance | Flagged |
|-------------|-------------|------|-------------------|-------------------|---------|

For myself, I ended up with
181 Activities totaling 1010 total miles
