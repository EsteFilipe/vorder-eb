var AWS = require('aws-sdk'),
    amazonCognitoIdentity = require('amazon-cognito-identity-js');
var ddb = new AWS.DynamoDB();

export default class UserService() {

  constructor(cognitoUserPool){
    this.userPool = new amazonCognitoIdentity.CognitoUserPool({
      UserPoolId : cognitoUserPool.user_pool_id,
      ClientId : cognitoUserPool.client_id // App Client id
    });
  }

  function login(email, password) {

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