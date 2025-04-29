#!/bin/bash

# Read inputs - validation is in the main workflow
SOURCE_DIR="$1"
ACCESS_TOKEN="$2"
DRIVE_ID="$3"
CALLBACKS="$4"
CONTEXT="$5"
#  How many (integer) seconds to sleep between uploads to avoid throttling - default is 1.0 seconds.
THROTTLE_SECONDS="${6:-1.0}"

echo "Uploading from: $SOURCE_DIR"
echo "Uploading to drive id: $DRIVE_ID"
sudo apt-get install jq

# Track uploads
UPLOAD_SUCCESSES=0
UPLOAD_FAILURES=0
UPLOAD_FAILED_FILES=''
UPLOAD_FOLDER_CREATION_FAILURES=''

create_folder() {
  local P_PATH="$1"
  local F_NAME="$2"

  create_response=$(curl -s -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
          "name": "'"${F_NAME}"'",
          "folder": {},
          "@microsoft.graph.conflictBehavior": "fail"
        }' \
    "https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:${P_PATH}:/children")

    if [[ "${response_code}" == "201" || "${response_code}" == "200" || "${response_code}" == "409" ]]; then
      echo "Creation of ${parent_path} succeeded or it already exists."
    else
      echo "Creation of $F_NAME failed with status: ${response_code}"
      UPLOAD_FOLDER_CREATION_FAILURES+="$F_NAME,"
    fi
}

# Function to upload files while preserving structure
upload_files() {
  local local_dir="$1"
  local sp_folder="$2"

  # Find and loop through all files and directories
  find "$local_dir" -type f -o -type d | while read -r item; do
    if [ "$item" == "$local_dir" ]; then
      continue
    fi
    relative_path="${item#"$local_dir"/}"
    echo "Relative path: $relative_path"
    sp_item_path="$sp_folder$relative_path"

    echo "Next found is: $item (local_dir: $local_dir, sp_folder: $sp_folder, relative_path: $relative_path, sp_item_path: $sp_item_path)"

    if [ -d "$item" ]; then
      # Create directory in SharePoint - ignoring results if it already exists
      echo "Creating directory: $relative_path in $sp_folder"
      create_folder "$parent_path" "$item"
    else
      echo "Uploading file: $item in $parent_dir of $sp_folder."
      # Ensure the parent directory exists in SharePoint
      parent_dir=$(dirname "$relative_path")
      create_folder "$sp_folder" "$parent_dir"

      retry_count=0

      while true; do
        # Upload file to SharePoint
        response_code=$(curl -X PUT \
          -H "Authorization: Bearer ${access_token}" \
          -H "Content-Type: application/octet-stream" \
          --data-binary @"$local_dir/$item" \
          "https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/$sp_folder/$parent_dir/$item:/content")

        if [[ "$response" == "429" ]]; then
          ((retry_count++))
          if [[ "$retry_count" -ge 3 ]]; then
            # TODO - should we stop if we hit a number of consecutive 429's?
            echo "Throttled on $parent_dir/$item. Retry limit reached. Skipping..."
            UPLOAD_FAILURES=$((UPLOAD_FAILURES + 1))
            UPLOAD_FAILED_FILES+="$parent_dir/$item,"
            break
          fi
          echo "Throttled on $parent_dir/$item ($retry_count/3). Retrying..."
          sleep 5
        elif [[ "${response_code}" -ge 400 ]]; then
          echo "Upload of /$sp_folder/$parent_dir/$item failed with HTTP status: ${response_code}"
          UPLOAD_FAILURES=$((UPLOAD_FAILURES + 1))
          UPLOAD_FAILED_FILES+="$parent_dir/$item,"
          break
        else
          UPLOAD_SUCCESSES=$((UPLOAD_SUCCESSES + 1))
          if (( UPLOAD_SUCCESSES % 100 == 0 )); then
            echo "Successfully uploaded $UPLOAD_SUCCESSES files so far. $UPLOAD_FAILED_FILES failed."
          fi
          break
        fi
      done

      # Sleep (to the closest second) to avoid throttling
      sleep "$THROTTLE_SECONDS"
    fi
  done
}

# Start upload process
upload_files "$SOURCE_DIR" "/"

echo "Files that failed to upload: $UPLOAD_FAILED_FILES"
echo "Files that uploaded: $UPLOAD_SUCCESSES"

# Output JSON result for GitHub Actions
echo "UPLOAD_FAILED_FILES=$UPLOAD_FAILED_FILES" >> $GITHUB_ENV
echo "UPLOAD_SUCCESSES=$UPLOAD_SUCCESSES" >> $GITHUB_ENV
echo "UPLOAD_MESSAGE=$UPLOAD_MESSAGE" >> $GITHUB_ENV
echo "UPLOAD_FAILURES=$UPLOAD_FAILURES" >> $GITHUB_ENV
echo "UPLOAD_FOLDER_CREATION_FAILURES=UPLOAD_FOLDER_CREATION_FAILURES" >> $GITHUB_ENV
