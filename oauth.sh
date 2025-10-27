#!/bin/zsh
CLIENT_SECRET="efe4c4bd42145f7d6c47b5688b7d3a395fcdaf9c"
CLIENT_ID="182466"

echo "Open the following page and copy the authorization code from the url"
echo "http://www.strava.com/oauth/authorize?client_id=$CLIENT_ID&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=force&scope=activity:read_all"
read -p "Enter the authorization code: " AUTH_CODE

curl -X POST https://www.strava.com/oauth/token \
	-F client_id=$CLIENT_ID \
	-F client_secret=$CLIENT_SECRET \
	-F code=$AUTH_CODE \
	-F grant_type=authorization_code \
  --output token.json
