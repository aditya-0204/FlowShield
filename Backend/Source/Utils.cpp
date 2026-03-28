#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "../Include/Constants.hpp"

using namespace std;
namespace fs = std::filesystem;

class FileWatcher {
public:
    explicit FileWatcher(string path) : watchPath(std::move(path)), rng(random_device{}()) {}

    void startMonitoring() {
        ensureDirectories();
        cout << "[FlowShield] Monitoring " << watchPath << " with a " << FlowShield::HEARTBEAT_INTERVAL_MS << "ms TFC heartbeat." << endl;

        while (true) {
            try {
                heartbeat();
            } catch (const exception& ex) {
                logEvent("error", "Watcher", ex.what(), "");
                cerr << "[FlowShield] " << ex.what() << endl;
            }

            this_thread::sleep_for(chrono::milliseconds(FlowShield::HEARTBEAT_INTERVAL_MS));
        }
    }

private:
    string watchPath;
    mt19937 rng;

    void heartbeat() {
        fs::path pending = nextMessageFile();
        if (!pending.empty()) {
            string content = readMessage(pending.string());
            logEvent("message", "Watcher", "Detected frontend payload file " + pending.filename().string(), pending.string());
            processMessage(content, pending.filename().string());
            fs::remove(pending);
            return;
        }

        generateChaff();
    }

    fs::path nextMessageFile() {
        vector<fs::directory_entry> txtFiles;

        for (const auto& entry : fs::directory_iterator(watchPath)) {
            if (entry.is_regular_file() && entry.path().extension() == ".txt") {
                txtFiles.push_back(entry);
            }
        }

        if (txtFiles.empty()) {
            return {};
        }

        sort(txtFiles.begin(), txtFiles.end(), [](const fs::directory_entry& left, const fs::directory_entry& right) {
            return fs::last_write_time(left.path()) < fs::last_write_time(right.path());
        });

        return txtFiles.front().path();
    }

    string readMessage(const string& filePath) {
        ifstream file(filePath);
        return string((istreambuf_iterator<char>(file)), istreambuf_iterator<char>());
    }

    void processMessage(const string& msg, const string& sourceName) {
        string payload = msg.empty() ? FlowShield::DEFAULT_MESSAGE : msg;
        vector<string> trace;
        vector<unsigned char> onion = CryptoEngine::encryptThreeLayerOnion(payload, trace);

        logEvent("message", "Crypto", "Wrapped payload \"" + payload + "\" in 3 AES-256-GCM onion layers.", sourceName);
        for (size_t i = 0; i < trace.size(); ++i) {
            logEvent("message", "Layer " + to_string(i + 1), trace[i], sourceName);
        }

        routePayload(onion, "morphed", "Encrypted onion hidden inside relay covers.");

        logEvent("message", "Relay 1", "Relay 1 receives a morphed PNG and peels the outer routing instruction.", "");
        logEvent("message", "Relay 2", "Relay 2 forwards the still-encrypted core while traffic volume stays constant.", "");
        logEvent("message", "Client", "Traffic Flow Confidentiality maintained with a constant 1.5s image cadence.", "");
    }

    void generateChaff() {
        vector<string> trace;
        vector<unsigned char> onion = CryptoEngine::encryptThreeLayerOnion(FlowShield::DEFAULT_MESSAGE + " [chaff]", trace);

        logEvent("chaff", "Heartbeat", "No user payload found. Emitting dummy relay traffic.", "");
        routePayload(onion, "chaff", "Dummy PNGs emitted to preserve traffic flow confidentiality.");
    }

    void routePayload(const vector<unsigned char>& onion, const string& prefix, const string& detail) {
        string stamp = timestampForFile();
        fs::path cover1 = pickCoverImage();
        fs::path cover2 = pickCoverImage(cover1.filename().string());

        fs::path relay1Output = fs::path(FlowShield::RELAY_1_PATH) / (prefix + "_relay1_" + stamp + ".png");
        fs::path relay2Output = fs::path(FlowShield::RELAY_2_PATH) / (prefix + "_relay2_" + stamp + ".png");

        bool relay1Ok = StegoEngine::hideOnion(cover1.string(), relay1Output.string(), onion, true);
        bool relay2Ok = StegoEngine::hideOnion(cover2.string(), relay2Output.string(), onion, true);

        logEvent(relay1Ok ? prefix : "error", "Stego", detail, relay1Output.string());
        logEvent(relay2Ok ? prefix : "error", "Stego", "Second relay image morphed for downstream forwarding.", relay2Output.string());
    }

    fs::path pickCoverImage(const string& avoid = "") {
        vector<fs::path> images;

        for (const auto& entry : fs::directory_iterator(FlowShield::COVER_IMAGE_POOL)) {
            if (entry.is_regular_file() && entry.path().extension() == ".png") {
                if (avoid.empty() || entry.path().filename().string() != avoid) {
                    images.push_back(entry.path());
                }
            }
        }

        if (images.empty() && !avoid.empty()) {
            for (const auto& entry : fs::directory_iterator(FlowShield::COVER_IMAGE_POOL)) {
                if (entry.is_regular_file() && entry.path().extension() == ".png") {
                    images.push_back(entry.path());
                }
            }
        }

        if (images.empty()) {
            throw runtime_error("No PNG cover images found in " + FlowShield::COVER_IMAGE_POOL);
        }

        uniform_int_distribution<size_t> dist(0, images.size() - 1);
        return images[dist(rng)];
    }

    void ensureDirectories() {
        fs::create_directories(watchPath);
        fs::create_directories(FlowShield::RELAY_1_PATH);
        fs::create_directories(FlowShield::RELAY_2_PATH);
        ofstream touchLog(FlowShield::TRAFFIC_LOG_PATH, ios::app);
        touchLog.close();
    }

    string timestampForFile() {
        auto now = chrono::system_clock::now();
        time_t nowTime = chrono::system_clock::to_time_t(now);
        tm localTm{};
#ifdef _WIN32
        localtime_s(&localTm, &nowTime);
#else
        localtime_r(&nowTime, &localTm);
#endif
        stringstream ss;
        ss << put_time(&localTm, "%Y%m%d_%H%M%S");
        auto millis = chrono::duration_cast<chrono::milliseconds>(now.time_since_epoch()).count() % 1000;
        ss << "_" << setw(3) << setfill('0') << millis;
        return ss.str();
    }

    string timestampForLog() {
        auto now = chrono::system_clock::now();
        time_t nowTime = chrono::system_clock::to_time_t(now);
        tm localTm{};
#ifdef _WIN32
        localtime_s(&localTm, &nowTime);
#else
        localtime_r(&nowTime, &localTm);
#endif
        stringstream ss;
        ss << put_time(&localTm, "%Y-%m-%d %H:%M:%S");
        return ss.str();
    }

    string escapeJson(const string& input) {
        string escaped;
        escaped.reserve(input.size() + 8);
        for (char ch : input) {
            switch (ch) {
                case '\\': escaped += "\\\\"; break;
                case '"': escaped += "\\\""; break;
                case '\n': escaped += "\\n"; break;
                case '\r': escaped += "\\r"; break;
                case '\t': escaped += "\\t"; break;
                default: escaped += ch; break;
            }
        }
        return escaped;
    }

    void logEvent(const string& type, const string& stage, const string& detail, const string& file) {
        ofstream logFile(FlowShield::TRAFFIC_LOG_PATH, ios::app);
        logFile << "{\"timestamp\":\"" << escapeJson(timestampForLog())
                << "\",\"type\":\"" << escapeJson(type)
                << "\",\"stage\":\"" << escapeJson(stage)
                << "\",\"detail\":\"" << escapeJson(detail)
                << "\",\"file\":\"" << escapeJson(file)
                << "\"}\n";
    }
};
