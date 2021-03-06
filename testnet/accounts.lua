json = require "json"

accounts = {
  faucet = {
    username = "faucet",
    -- note that the avash_call parser is pretty brain-dead, so we can't have spaces in any json strings
    password = "good-cub-book",
    -- Private key for the default, pre-funded X-Chain account on local test networks:
    wallet = {{
      address = "X-local18jma8ppw3nhx5r4ap8clazz0dps7rv5u00z96u",
      privateKey = "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN",
    }},
  },

  test1 = {
    username = "test1",
    password = "good-cub-book",
    wallet = {{
      address = "X-local1r0t6cce8yece0ksdfestg87c8xuhs8fc0mvsfr",
      privateKey = "PrivateKey-2MuCQHXZgxnMNgDShBCK2MJ7WcghPKJU6GERN18mG3inZFZoe4",
      initialFunds = 20000000,
    }},
  },
  test2 = {
    username = "test2",
    password = "good-cub-book",
    wallet = {{
      address = "X-local1cj7gnk75hdlu9r3hvrr2eksq8zprmqd8ghxpve",
      privateKey = "PrivateKey-VDPdTm6a77KD3ATnwm3hMbzrvK8mvo9fzkQDYWyJ7oaC5g8fC",
      initialFunds = 30000000,
    }},
  },
}

function account_credentials (account)
  if account.username == nil or account.password == nil then return nil end
  return {
    username = account.username,
    password = account.password,
  }
end

function create_keystore_user (node, account)
  cred = account_credentials(account)
  if cred ~= nil then
    print("creating gecko keystore user " .. account.username .. " on " .. node)
    avash_call("callrpc " .. node .. " ext/keystore keystore.createUser " .. json.encode(account_credentials(account)) .. " st nid")
    for index, addressSpec in ipairs(account.wallet or {}) do
      if addressSpec.privateKey ~= nil then
        cred = account_credentials(account)
        cred.privateKey = addressSpec.privateKey
        address = addressSpec.address or "unknown"
        print("importing private key for address " .. address)
        avash_call("callrpc " .. node .. " ext/bc/X avm.importKey " .. json.encode(cred) .. " st nid")
      end
    end
  end
end

function create_keystore_users (node, accounts)
  for index, account in pairs(accounts) do
    create_keystore_user(node, account)
  end
end

function fund_accounts (node, faucet, accounts)
  first = true
  for index, account in pairs(accounts) do
    for windex, address in ipairs(account.wallet or {}) do
      if address.address ~= nil and address.initialFunds ~= nil then
        if first then
          first = false
        else
          avash_sleepmicro(2000000)
        end
        print("sending " .. address.initialFunds .. " to " .. address.address)
        params = account_credentials(faucet)
        params.assetID = "AVAX"
        params.amount = address.initialFunds
        params.to = address.address
        avash_call("callrpc " .. node .. " ext/bc/X avm.send " .. json.encode(params) .. " st nid")
      end
    end
  end
end

create_keystore_users ("n1", accounts)
fund_accounts ("n1", accounts.faucet, accounts)
