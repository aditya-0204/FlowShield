#include <iostream>
#include "../Include/Constants.hpp"
#include "Crypto_Engine.cpp"
#include "Stego_Engine.cpp"
#include "Utils.cpp"

using namespace std;

int main(int argc, char* argv[]) {
    cout << "--- FlowShield Engine Started ---" << endl;
    cout << "[FlowShield] Objective: Asynchronous Steganographic Onion Router with TFC heartbeat." << endl;

    if (argc >= 3 && string(argv[1]) == "receive") {
        fs::path relayImage = argv[2];
        string prefix = argc >= 4 ? argv[3] : "";

        try {
            fs::path output = ReceiverProcessor::processRelayImage(relayImage, prefix);
            cout << "[FlowShield] Receiver recovered plaintext into " << output.string() << endl;
            return 0;
        } catch (const exception& ex) {
            cerr << "[FlowShield] Receiver mode failed: " << ex.what() << endl;
            return 1;
        }
    }

    FileWatcher watcher(FlowShield::CLIENT_INBOX);
    watcher.startMonitoring();
    return 0;
}
