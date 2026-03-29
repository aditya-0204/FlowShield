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

    static string decryptThreeLayerOnion(const vector<unsigned char>& onion, vector<string>& trace) {
        vector<unsigned char> current = onion;

        for (int i = 2; i >= 0; --i) {
            current = decryptLayer(current, keyForLayer(static_cast<size_t>(i)));
            trace.push_back("Receiver peeled layer " + to_string(3 - i));
        }

        return string(current.begin(), current.end());
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

        if (!digest) {
            throw runtime_error("Failed to create OpenSSL digest context for key derivation.");
        }

        EVP_DigestInit_ex(digest, EVP_sha256(), nullptr);
        EVP_DigestUpdate(digest, seeds[layerIndex].data(), seeds[layerIndex].size());
        EVP_DigestFinal_ex(digest, key.data(), &outLen);
        EVP_MD_CTX_free(digest);

        if (outLen != 32) {
            throw runtime_error("Failed to derive a 256-bit AES key.");
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

    static vector<unsigned char> decryptLayer(const vector<unsigned char>& package, const vector<unsigned char>& key) {
        if (package.size() < 28) {
            throw runtime_error("Encrypted onion layer is too small to contain AES-GCM metadata.");
        }

        const unsigned char* iv = package.data();
        const unsigned char* tag = package.data() + 12;
        const unsigned char* ciphertext = package.data() + 28;
        int ciphertextLen = static_cast<int>(package.size() - 28);

        EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
        if (!ctx) {
            throw runtime_error("Failed to create OpenSSL context for decryption.");
        }

        vector<unsigned char> plaintext(static_cast<size_t>(ciphertextLen) + 16, 0);
        int len = 0;
        int plaintextLen = 0;

        if (EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1 ||
            EVP_DecryptInit_ex(ctx, nullptr, nullptr, key.data(), iv) != 1 ||
            EVP_DecryptUpdate(ctx, plaintext.data(), &len, ciphertext, ciphertextLen) != 1) {
            EVP_CIPHER_CTX_free(ctx);
            throw runtime_error("Failed during AES-GCM decryption.");
        }

        plaintextLen = len;

        if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, 16, const_cast<unsigned char*>(tag)) != 1) {
            EVP_CIPHER_CTX_free(ctx);
            throw runtime_error("Failed to set AES-GCM authentication tag for verification.");
        }

        int finalStatus = EVP_DecryptFinal_ex(ctx, plaintext.data() + plaintextLen, &len);
        EVP_CIPHER_CTX_free(ctx);

        if (finalStatus != 1) {
            throw runtime_error("AES-GCM tag verification failed while peeling the onion.");
        }

        plaintextLen += len;
        plaintext.resize(static_cast<size_t>(plaintextLen));
        return plaintext;
    }
};
