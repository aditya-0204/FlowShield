#pragma once

#include <string>

using namespace std;

namespace FlowShield {
    inline constexpr int HEARTBEAT_INTERVAL_MS = 1500;
    inline const string DEFAULT_MESSAGE = "Hi Aditya";
    inline const string CLIENT_INBOX = "../Storage_system/node_client/";
    inline const string RELAY_1_PATH = "../Storage_system/node_relay_1/";
    inline const string RELAY_2_PATH = "../Storage_system/node_relay_2/";
    inline const string RECEIVER_PATH = "../Storage_system/node_receiver/";
    inline const string TRAFFIC_LOG_PATH = "../Storage_system/traffic_log.jsonl";
    inline const string COVER_IMAGE_POOL = "./assets/covers/";
}
