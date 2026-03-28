#include <iostream>
#include "../Include/Constants.hpp"
#include "Crypto_Engine.cpp"
#include "Stego_Engine.cpp"
#include "Utils.cpp"

using namespace std;

int main() {
    cout << "--- FlowShield Engine Started ---" << endl;
    cout << "[FlowShield] Objective: Asynchronous Steganographic Onion Router with TFC heartbeat." << endl;

    FileWatcher watcher(FlowShield::CLIENT_INBOX);
    watcher.startMonitoring();
    return 0;
}
