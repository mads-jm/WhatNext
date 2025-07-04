# Start the helper service

# args : port (default 4200)
PORT=${1:-4200}

cd service
npx ts-node src/server.ts $PORT
