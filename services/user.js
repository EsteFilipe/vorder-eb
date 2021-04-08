var AWS = require('aws-sdk'),
    amazonCognitoIdentity = require('amazon-cognito-identity-js');

module.exports = function (cognitoUserPool) {

  var ddb = new AWS.DynamoDB();

  var UserService = function() {
    this.userPool = new amazonCognitoIdentity.CognitoUserPool({
      UserPoolId : cognitoUserPool.user_pool_id,
      ClientId : cognitoUserPool.client_id // App Client id
    });
  }

  UserService.prototype = {

    login: function(email, password) {

      var authenticationDetails = new amazonCognitoIdentity.AuthenticationDetails({
          Username : email,
          Password : password,
      });

      console.log(this.userPool);

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
  }

  return UserService;
}