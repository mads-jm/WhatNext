# Check for nvm and install if not found
if ! command -v nvm &> /dev/null; then
    echo "nvm could not be found, installing..."
    
    # Install nvm
    if curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash; then
        echo "nvm installation completed"
        
        # Try to load nvm in current session
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
        
        # Verify nvm is now available
        if ! command -v nvm &> /dev/null; then
            echo "Warning: nvm installed but not available in current session"
            echo "Please restart your terminal or run: source ~/.bashrc"
            echo "Then run this script again"
            exit 1
        fi
    else
        echo "Error: Failed to install nvm"
        exit 1
    fi
fi

# check current available node versions and install required minimum if not found v24.3.0
if ! nvm ls | grep -q "v24.3.0"; then
  nvm install v24.3.0
fi

# check current node version
if ! nvm current | grep -q "v24.3.0"; then
  nvm use v24.3.0
fi

# Initialize success flags
APP_DEPS_SUCCESS=false
SERVICE_DEPS_SUCCESS=false
NODE_VERSION_SUCCESS=false

# Install app dependencies
cd app
if npm install; then
    APP_DEPS_SUCCESS=true
fi

# Install service dependencies
cd ../service
if npm install; then
    SERVICE_DEPS_SUCCESS=true
fi

cd ..

# Check if nvm/node version is working correctly
if command -v nvm &> /dev/null && nvm current &> /dev/null; then
    NODE_VERSION_SUCCESS=true
fi

echo "Dev environment initialized"
echo "Summary:"

# Print success messages only if respective steps completed without error
if [ "$NODE_VERSION_SUCCESS" = true ]; then
    echo "Node version: $(nvm current)"
fi

if [ "$APP_DEPS_SUCCESS" = true ]; then
    echo "App dependencies installed"
fi

if [ "$SERVICE_DEPS_SUCCESS" = true ]; then
    echo "Service dependencies installed"
fi
