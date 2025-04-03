#!/bin/bash

# Read inputs - validation is in the main workflow
SOURCE_DIR="$1"
SHAREPOINT_SITE_URL="$2"
SHAREPOINT_TENANT_ID="$3"
AZURE_APP_ID="$4"
AZURE_CERTIFICATE_BASE64="$5"
AZURE_CERTIFICATE_PASSWORD="$6"
CALLBACKS="$6"
CONTEXT="$7"

echo "Uploading from: $SOURCE_DIR"
echo "Uploading to: $SHAREPOINT_SITE_URL"
sudo apt-get install jq

# Authenticate to SharePoint
if ! command -v m365 &> /dev/null; then
  echo "Installing m365 CLI..."
  npm install -g @pnp/cli-microsoft365
fi

# Check if install failed and return.
if ! command -v m365 &> /dev/null; then
  echo "Failed to install m365."
  # Create an error result
  UPLOAD_SUCCESSES=0
  UPLOAD_FAILURES=1
  UPLOAD_MESSAGE="Error: M365 was not installed."
  UPLOAD_FAILED_FILES=''
else
  echo "Setting up m365 CLI..."
  m365 --version 2>&1 | head -n 1

  m365 setup --scripting
  m365 cli config set --key helpMode --value "full"
  #m365 cli config set --key clientId --value $SHAREPOINT_CLIENT_ID
  #m365 cli config set --key tenantId --value $SHAREPOINT_TENANT_ID
  #m365 cli config set --key authType --value secret
  echo "m365 is setup up.  Now authenticating..."

  #m365 status -o json 2>&1
  #m365 status -o json 2>&1 | jq -e '.connectionName' > /dev/null 2>&1
  #m365_status=$?
  #m365_status=1

  #echo "m365 status checked.  Status: $m365_status"
  #if [ "$m365_status" -gt 0 ]; then
  echo "Authenticating with SharePoint"
  echo "${{ AZURE_CERTIFICATE_BASE64 }}" | base64 -d > azure_cert.pfx
  if ! m365 login --authType certificate --certificateFile azure_cert.pfx --password "$AZURE_CERTIFICATE_PASSWORD" --appId "$AZURE_APP_ID" --tenant "$SHAREPOINT_TENANT_ID"; then
    echo "Failed to authenticate with SharePoint"
    # Create an error result
    UPLOAD_SUCCESSES=0
    UPLOAD_FAILURES=1
    UPLOAD_MESSAGE="Error: M365 was not installed."
    UPLOAD_FAILED_FILES=''
  else
    echo "✅ Successfully authenticated"

    # Track uploads
    UPLOAD_SUCCESSES=0
    UPLOAD_FAILURES=0
    UPLOAD_FAILED_FILES=''

    # Function to upload files while preserving structure
    upload_files() {
      local local_dir="$1"
      local sp_folder="$2"

      # Find and loop through all files and directories
      find "$local_dir" -type f -o -type d | while read -r item; do
        if [ "$item" == "$local_dir" ]; then
          continue
        fi
        echo "Processing item: $item"
        echo "Local directory: $local_dir"
        relative_path="${item#"$local_dir"/}"
        echo "Relative path: $relative_path"
        sp_item_path="$sp_folder$relative_path"

        echo "Next found is: $item (local_dir: $local_dir, sp_folder: $sp_folder, relative_path: $relative_path, sp_item_path: $sp_item_path)"

        if [ -d "$item" ]; then
          # Create directory in SharePoint
          echo "Creating directory: $relative_path in $sp_folder"
          m365 spo folder add --webUrl "$SHAREPOINT_SITE_URL" --parentFolderUrl "$sp_folder" --name "$relative_path"
        else
          echo "Uploading file: $item in $parent_dir of $sp_folder, ensuring the parent directory exists"
          # Ensure the parent directory exists in SharePoint
          parent_dir=$(dirname "$relative_path")
          m365 spo folder add --webUrl "$SHAREPOINT_SITE_URL" --parentFolderUrl "$sp_folder" --name "$parent_dir"

          # Upload file to SharePoint
          if m365 spo file add --webUrl "$SHAREPOINT_SITE_URL" --folder "$sp_folder/$parent_dir" --path "$item" --overwrite; then
            UPLOAD_SUCCESSES=$((UPLOAD_SUCCESSES + 1))
          else
            UPLOAD_FAILURES=$((UPLOAD_FAILURES + 1))
            UPLOAD_FAILED_FILES+="$relative_path,"
          fi
        fi
      done
    }

    # Start upload process
    upload_files "$SOURCE_DIR" "/"

    echo "Files that failed to upload: $UPLOAD_FAILED_FILES"
    echo "Files that uploaded: $UPLOAD_SUCCESSES"
  fi
fi

# Output JSON result for GitHub Actions
echo "UPLOAD_FAILED_FILES=$UPLOAD_FAILED_FILES" >> $GITHUB_ENV
echo "UPLOAD_SUCCESSES=$UPLOAD_SUCCESSES" >> $GITHUB_ENV
echo "UPLOAD_MESSAGE=$UPLOAD_MESSAGE" >> $GITHUB_ENV
echo "UPLOAD_FAILURES=$UPLOAD_FAILURES" >> $GITHUB_ENV
