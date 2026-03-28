#include "../Include/lodepng.h"
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

using namespace std;
namespace fs = std::filesystem;

class StegoEngine {
public:
    static bool hideOnion(const string& inputPath, const string& outputPath, const vector<unsigned char>& onionData, bool morphImage = true) {
        vector<unsigned char> image;
        unsigned width = 0;
        unsigned height = 0;

        unsigned error = lodepng::decode(image, width, height, inputPath);
        if (error != 0) {
            cout << "[Stego] Failed to load cover image: " << inputPath << endl;
            return false;
        }

        vector<unsigned char> payload = withLengthPrefix(onionData);
        if (payload.size() * 8 > usableChannels(image)) {
            cout << "[Stego] Cover image is too small for the encrypted onion payload." << endl;
            return false;
        }

        embedPayload(image, payload);

        if (morphImage) {
            applyMorph(image);
        }

        fs::create_directories(fs::path(outputPath).parent_path());
        error = lodepng::encode(outputPath, image, width, height);
        if (error != 0) {
            cout << "[Stego] Failed to write morphed image: " << outputPath << endl;
            return false;
        }

        return true;
    }

private:
    static vector<unsigned char> withLengthPrefix(const vector<unsigned char>& onionData) {
        uint32_t size = static_cast<uint32_t>(onionData.size());
        vector<unsigned char> payload(4, 0);
        payload[0] = static_cast<unsigned char>((size >> 24) & 0xFF);
        payload[1] = static_cast<unsigned char>((size >> 16) & 0xFF);
        payload[2] = static_cast<unsigned char>((size >> 8) & 0xFF);
        payload[3] = static_cast<unsigned char>(size & 0xFF);
        payload.insert(payload.end(), onionData.begin(), onionData.end());
        return payload;
    }

    static size_t usableChannels(const vector<unsigned char>& image) {
        return (image.size() / 4) * 3;
    }

    static void embedPayload(vector<unsigned char>& image, const vector<unsigned char>& payload) {
        size_t channelIndex = 0;

        for (unsigned char byte : payload) {
            for (int bit = 7; bit >= 0; --bit) {
                while ((channelIndex % 4) == 3) {
                    ++channelIndex;
                }

                unsigned char bitValue = static_cast<unsigned char>((byte >> bit) & 0x01);
                image[channelIndex] = static_cast<unsigned char>((image[channelIndex] & 0xFE) | bitValue);
                ++channelIndex;
            }
        }
    }

    static void applyMorph(vector<unsigned char>& image) {
        for (size_t i = 0; i < image.size(); i += 4) {
            image[i] = static_cast<unsigned char>((image[i] + ((i / 4) % 5)) % 255);
            if (i + 1 < image.size()) {
                image[i + 1] = static_cast<unsigned char>((image[i + 1] + ((i / 8) % 3)) % 255);
            }
        }
    }
};
