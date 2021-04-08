var AWS = require('aws-sdk'),
    amazonCognitoIdentity = require('amazon-cognito-identity-js');

module.exports = function (cognitoUserPool) {

  var ddb = new AWS.DynamoDB();

  var UserService = function () {
    this.userPool = new amazonCognitoIdentity.CognitoUserPool({
      UserPoolId : cognitoUserPool.user_pool_id,
      ClientId : cognitoUserPool.client_id // App Client id
    });
  }

  UserService.prototype.login = function(email, password) {

      var authenticationDetails = new amazonCognitoIdentity.AuthenticationDetails({
          Username : email,
          Password : password,
      });

      var userData = {
          Username : email,
          Pool : this.userPool
      };

      var cognitoUser = new amazonCognitoIdentity.CognitoUser(userData);

      return new Promise((resolve, reject) => {
          cognitoUser.authenticateUser(authenticationDetails, {
              onSuccess: (result) => {
                  //console.log('successfully authenticated', result);
                  resolve(result);
              },
              onFailure: (err) => {
                  //console.log('error authenticating', err);
                  reject(err);
              }
          });
      });
    }

    // For several Cognito examples, check:
    //https://medium.com/@prasadjay/amazon-cognito-user-pools-in-nodejs-as-fast-as-possible-22d586c5c8ec
    UserService.prototype.registerUser = function(email, password){
        var attributeList = [];
        attributeList.push(new amazonCognitoIdentity.CognitoUserAttribute({Name:"email",Value:email}));

        return new Promise((resolve, reject) => {
            this.userPool.signUp(email, password, attributeList, null, (err, result) => {
                if (err) {
                    //console.log(err.message);
                    reject(err);
                    return;
                }
                cognitoUser = result.user;
                resolve(cognitoUser)
            });
        });
    }

  return new UserService();
}