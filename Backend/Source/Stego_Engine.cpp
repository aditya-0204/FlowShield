#include "../Include/lodepng.h"
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <stdexcept>
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

        if (morphImage) {
            applyMorph(image);
        }

        embedPayload(image, payload);

        fs::create_directories(fs::path(outputPath).parent_path());
        error = lodepng::encode(outputPath, image, width, height);
        if (error != 0) {
            cout << "[Stego] Failed to write morphed image: " << outputPath << endl;
            return false;
        }

        return true;
    }

    static vector<unsigned char> extractOnion(const string& inputPath) {
        vector<unsigned char> image;
        unsigned width = 0;
        unsigned height = 0;

        unsigned error = lodepng::decode(image, width, height, inputPath);
        if (error != 0) {
            throw runtime_error("Failed to load stego image for extraction: " + inputPath);
        }

        vector<unsigned char> payload;
        payload.reserve(usableChannels(image) / 8);

        size_t channelIndex = 0;
        size_t bytesToRead = 0;
        bool haveLength = false;

        while (channelIndex < image.size()) {
            unsigned char byte = 0;

            for (int bit = 7; bit >= 0; --bit) {
                while (channelIndex < image.size() && (channelIndex % 4) == 3) {
                    ++channelIndex;
                }

                if (channelIndex >= image.size()) {
                    throw runtime_error("Unexpected end of image while extracting the stego payload.");
                }

                byte |= static_cast<unsigned char>((image[channelIndex] & 0x01) << bit);
                ++channelIndex;
            }

            payload.push_back(byte);

            if (!haveLength && payload.size() == 4) {
                bytesToRead =
                    (static_cast<size_t>(payload[0]) << 24) |
                    (static_cast<size_t>(payload[1]) << 16) |
                    (static_cast<size_t>(payload[2]) << 8) |
                    static_cast<size_t>(payload[3]);
                payload.clear();
                payload.reserve(bytesToRead);
                haveLength = true;
            }

            if (haveLength && payload.size() == bytesToRead) {
                return payload;
            }
        }

        throw runtime_error("Stego payload extraction failed before reaching the declared payload size.");
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
