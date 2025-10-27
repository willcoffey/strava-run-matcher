// Contains client secret & client id
interface ClientSecrets {
  client_id: string;
  client_secret: string;
}
const { client_id, client_secret }: ClientSecrets = loadFile("./secrets.json") as ClientSecrets;

// Create the url to generate auth code
const urlToVisit =
  `https://www.strava.com/oauth/authorize?client_id=${client_id}&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=force&scope=activity:read_all`;
console.log("Visit the following URL and copy the auth code from the url");
console.log(urlToVisit);

// Read the authorization code from user
let AUTH_CODE = "";
while (!AUTH_CODE) {
  AUTH_CODE = prompt("Enter the authorization code: ");
}

// Use the auth code to get the access token and save it
const tokenUrl = `https://www.strava.com/oauth/token`;

const response = await fetch(tokenUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    client_id,
    client_secret,
    code: AUTH_CODE,
    grant_type: "authorization_code",
  }),
});
const tokenData = await response.json();
Deno.writeTextFileSync("token.json", JSON.stringify(tokenData, null, 2));

function loadFile(path: string): unknown {
  const file = Deno.readTextFileSync(path);
  return JSON.parse(file);
}
