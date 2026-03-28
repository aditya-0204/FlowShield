#include <openssl/evp.h>
#include <openssl/rand.h>
#include <array>
#include <stdexcept>
#include <string>
#include <vector>

#include "../Include/Constants.hpp"

using namespace std;

class CryptoEngine {
public:
    static vector<unsigned char> encryptThreeLayerOnion(const string& message, vector<string>& trace) {
        string payload = message.empty() ? FlowShield::DEFAULT_MESSAGE : message;
        vector<unsigned char> onion(payload.begin(), payload.end());

        const array<string, 3> labels = {
            "Relay 3 outer shell sealed",
            "Relay 2 middle shell sealed",
            "Relay 1 inner shell sealed"
        };

        for (size_t i = 0; i < labels.size(); ++i) {
            onion = encryptLayer(onion, keyForLayer(i));
            trace.push_back(labels[i]);
        }

        return onion;
    }

private:
    static vector<unsigned char> keyForLayer(size_t layerIndex) {
        static const array<string, 3> seeds = {
            "flowshield-relay-alpha-2026",
            "flowshield-relay-beta-2026",
            "flowshield-relay-gamma-2026"
        };

        vector<unsigned char> key(32, 0);
        EVP_MD_CTX* digest = EVP_MD_CTX_new();
        unsigned int outLen = 0;

        EVP_DigestInit_ex(digest, EVP_sha256(), nullptr);
        EVP_DigestUpdate(digest, seeds[layerIndex].data(), seeds[layerIndex].size());
        EVP_DigestFinal_ex(digest, key.data(), &outLen);
        EVP_MD_CTX_free(digest);

        if (outLen != 32) {
            throw runtime_error("Failed to derive 256-bit AES key.");
        }

        return key;
    }

    static vector<unsigned char> encryptLayer(const vector<unsigned char>& plaintext, const vector<unsigned char>& key) {
        EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
        if (!ctx) {
            throw runtime_error("Failed to create OpenSSL context.");
        }

        vector<unsigned char> iv(12, 0);
        vector<unsigned char> tag(16, 0);
        vector<unsigned char> ciphertext(plaintext.size() + 16, 0);
        int len = 0;
        int ciphertextLen = 0;

        if (RAND_bytes(iv.data(), static_cast<int>(iv.size())) != 1) {
            EVP_CIPHER_CTX_free(ctx);
            throw runtime_error("Failed to generate AES-GCM IV.");
        }

        if (EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1 ||
            EVP_EncryptInit_ex(ctx, nullptr, nullptr, key.data(), iv.data()) != 1 ||
            EVP_EncryptUpdate(ctx, ciphertext.data(), &len, plaintext.data(), static_cast<int>(plaintext.size())) != 1) {
            EVP_CIPHER_CTX_free(ctx);
            throw runtime_error("Failed during AES-GCM encryption.");
        }

        ciphertextLen = len;

        if (EVP_EncryptFinal_ex(ctx, ciphertext.data() + ciphertextLen, &len) != 1) {
            EVP_CIPHER_CTX_free(ctx);
            throw runtime_error("Failed to finalize AES-GCM encryption.");
        }

        ciphertextLen += len;

        if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, static_cast<int>(tag.size()), tag.data()) != 1) {
            EVP_CIPHER_CTX_free(ctx);
            throw runtime_error("Failed to read AES-GCM authentication tag.");
        }

        EVP_CIPHER_CTX_free(ctx);
        ciphertext.resize(ciphertextLen);

        vector<unsigned char> package;
        package.reserve(iv.size() + tag.size() + ciphertext.size());
        package.insert(package.end(), iv.begin(), iv.end());
        package.insert(package.end(), tag.begin(), tag.end());
        package.insert(package.end(), ciphertext.begin(), ciphertext.end());
        return package;
    }
};
