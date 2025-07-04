# Start the Electron app
# args : service address (default localhost:4200), app-port (default 5173)
# args unused atm
SERVICE_ADDRESS=${1:-http://localhost:4200}
APP_PORT=${2:-5173}

cd app
npm run dev $SERVICE_ADDRESS $APP_PORT